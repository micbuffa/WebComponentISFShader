export class ISFRenderer {
  constructor({ onLog } = {}) {
    this.onLog = typeof onLog === 'function' ? onLog : () => {};

    this.canvas = null;
    this.gl = null;

    this.currentISF = null;
    this.inputDefs = [];
    this.inputValues = new Map();
    this.imageTextures = new Map();
    this.externalImageTextures = new Map();

    this.programPasses = [];
    this.namedTargets = new Map();
    this.persistentTargets = new Map();
    this.finalOutputTarget = null;
    this.outputToTexture = false;

    this.fullscreenBuffer = null;

    this.animationFrame = null;
    this.running = false;

    this.startTime = performance.now();
    this.lastTime = performance.now();
    this.frameIndex = 0;
  }

  log(message) {
    this.onLog(message);
  }

  connect(canvas, options = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('ISFRenderer.connect(canvas) attend un HTMLCanvasElement');
    }

    const sharedGL = options.sharedGL || null;

    if (sharedGL) {
      this.canvas = canvas;
      this.gl = sharedGL;
      this.#initQuad();

      if (this.currentISF) {
        this.#rebuildPipeline();
      }
      return;
    }

    this.canvas = canvas;
    this.gl =
      canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: false
      }) ||
      canvas.getContext('experimental-webgl');

    if (!this.gl) {
      throw new Error('WebGL non disponible');
    }

    this.#initQuad();

    if (this.currentISF) {
      this.#rebuildPipeline();
    }
  }

  disconnect() {
    this.stop();
    this.#disposePipeline();
    this.canvas = null;
    this.gl = null;
  }

  setISF(isf) {
    this.currentISF = isf;
    this.inputDefs = Array.isArray(isf?.metadata?.INPUTS) ? isf.metadata.INPUTS : [];

    this.#applyDefaultInputValues();

    if (this.gl) {
      this.#rebuildPipeline();
    }
  }

  setInputValue(name, value) {
    this.inputValues.set(name, value);
  }

  setExternalTextureInput(name, texture) {
    if (!name) return;

    if (texture) {
      this.externalImageTextures.set(name, texture);
    } else {
      this.externalImageTextures.delete(name);
    }
  }

  clearExternalTextureInput(name) {
    this.externalImageTextures.delete(name);
  }

  setOutputToTexture(enabled) {
    this.outputToTexture = Boolean(enabled);
  }

  getOutputTexture() {
    return this.finalOutputTarget?.texture || null;
  }

  setValue(name, value) {
    this.setInputValue(name, value);
  }

  getInputValue(name) {
    return this.inputValues.get(name);
  }

  async setImageInput(name, fileOrBitmap) {
    if (!this.gl) {
      throw new Error("Le renderer n'est pas connecté à un canvas");
    }

    let bitmap = null;

    if (fileOrBitmap instanceof ImageBitmap) {
      bitmap = fileOrBitmap;
    } else if (fileOrBitmap instanceof Blob) {
      bitmap = await createImageBitmap(fileOrBitmap);
    } else {
      throw new Error('setImageInput attend un Blob/File ou un ImageBitmap');
    }

    const tex = this.#createTextureFromImage(bitmap);
    this.imageTextures.set(name, tex);
  }

  start() {
    if (!this.gl || !this.canvas) {
      throw new Error('Renderer non connecté');
    }

    if (this.running) return;
    this.running = true;

    const tick = () => {
      if (!this.running) return;
      this.render();
      this.animationFrame = requestAnimationFrame(tick);
    };

    this.animationFrame = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  render() {
    const gl = this.gl;
    const canvas = this.canvas;

    if (!gl || !canvas || !this.programPasses.length) return;

    const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 1);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    this.#ensureAllTargetSizes(width, height);

    const now = performance.now();
    const timeSec = (now - this.startTime) / 1000;
    const deltaSec = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;

    for (let passIdx = 0; passIdx < this.programPasses.length; passIdx++) {
      const pass = this.programPasses[passIdx];
      const { program, uniforms, output } = pass;
      const isLastPass = passIdx === this.programPasses.length - 1;

      if (output) {
        if (output.persistent) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, output.write.framebuffer);
        } else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
        }
      } else if (this.outputToTexture && isLastPass) {
        if (!this.finalOutputTarget) {
          this.finalOutputTarget = this.#createRenderTarget();
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.finalOutputTarget.framebuffer);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);

      const posLoc = gl.getAttribLocation(program, 'a_position');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      this.#bindBuiltins(uniforms, width, height, timeSec, deltaSec, pass.index);
      this.#bindInputUniforms(uniforms);
      this.#bindPassTextures(uniforms);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    for (const target of this.persistentTargets.values()) {
      const tmp = target.read;
      target.read = target.write;
      target.write = tmp;
    }

    this.frameIndex += 1;
  }

  #applyDefaultInputValues() {
    for (const input of this.inputDefs) {
      if (this.inputValues.has(input.NAME)) continue;

      switch (input.TYPE) {
        case 'float':
        case 'long':
        case 'int':
          this.inputValues.set(input.NAME, Number(input.DEFAULT ?? input.MIN ?? 0));
          break;
        case 'bool':
          this.inputValues.set(input.NAME, input.DEFAULT ? 1 : 0);
          break;
        case 'color':
          this.inputValues.set(
            input.NAME,
            Array.isArray(input.DEFAULT) ? input.DEFAULT.slice(0, 4) : [1, 1, 1, 1]
          );
          break;
        case 'point2D':
          this.inputValues.set(
            input.NAME,
            Array.isArray(input.DEFAULT) ? input.DEFAULT.slice(0, 2) : [0.5, 0.5]
          );
          break;
        case 'image':
          break;
        default:
          this.log(`Type d'input non géré: ${input.TYPE} (${input.NAME})`);
      }
    }
  }

  #rebuildPipeline() {
    this.#disposePipeline();

    if (!this.currentISF) return;

    const passes = Array.isArray(this.currentISF.metadata?.PASSES)
      ? this.currentISF.metadata.PASSES
      : [];

    const effectivePasses = passes.length ? passes : [{}];

    for (let i = 0; i < effectivePasses.length; i++) {
      const passDef = effectivePasses[i];
      const program = this.#createProgramForPass(i);
      const uniforms = this.#collectUniforms(program);
      const output = this.#resolvePassOutput(passDef);

      this.programPasses.push({
        index: i,
        passDef,
        program,
        uniforms,
        output
      });
    }

    this.log(`Pipeline ISF compilée (${effectivePasses.length} passe(s))`);
  }

  #disposePipeline() {
    const gl = this.gl;
    if (!gl) return;

    for (const pass of this.programPasses) {
      if (pass.program) {
        gl.deleteProgram(pass.program);
      }
    }
    this.programPasses = [];

    for (const target of this.namedTargets.values()) {
      this.#destroyRenderTarget(target);
    }
    this.namedTargets.clear();

    for (const pair of this.persistentTargets.values()) {
      this.#destroyRenderTarget(pair.read);
      this.#destroyRenderTarget(pair.write);
    }
    this.persistentTargets.clear();

    if (this.finalOutputTarget) {
      this.#destroyRenderTarget(this.finalOutputTarget);
      this.finalOutputTarget = null;
    }
  }

  #destroyRenderTarget(target) {
    const gl = this.gl;
    if (!gl || !target) return;
    if (target.texture) gl.deleteTexture(target.texture);
    if (target.framebuffer) gl.deleteFramebuffer(target.framebuffer);
  }

  #resolvePassOutput(passDef) {
    if (!passDef || !passDef.TARGET) return null;

    const persistent = Boolean(passDef.PERSISTENT);

    if (persistent) {
      if (!this.persistentTargets.has(passDef.TARGET)) {
        this.persistentTargets.set(passDef.TARGET, {
          persistent: true,
          read: this.#createRenderTarget(),
          write: this.#createRenderTarget()
        });
      }
      return this.persistentTargets.get(passDef.TARGET);
    }

    if (!this.namedTargets.has(passDef.TARGET)) {
      this.namedTargets.set(passDef.TARGET, this.#createRenderTarget());
    }

    return this.namedTargets.get(passDef.TARGET);
  }

  #ensureAllTargetSizes(width, height) {
    for (const target of this.namedTargets.values()) {
      this.#ensureTargetSize(target, width, height);
    }

    for (const pair of this.persistentTargets.values()) {
      this.#ensureTargetSize(pair.read, width, height);
      this.#ensureTargetSize(pair.write, width, height);
    }

    if (this.outputToTexture) {
      if (!this.finalOutputTarget) {
        this.finalOutputTarget = this.#createRenderTarget();
      }
      this.#ensureTargetSize(this.finalOutputTarget, width, height);
    }
  }

  #createRenderTarget() {
    const gl = this.gl;

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    return { texture, framebuffer, width: 0, height: 0 };
  }

  #ensureTargetSize(target, width, height) {
    const gl = this.gl;
    if (!target) return;
    if (target.width === width && target.height === height) return;

    target.width = width;
    target.height = height;

    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
  }

  #initQuad() {
    const gl = this.gl;
    if (!gl || this.fullscreenBuffer) return;

    this.fullscreenBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1
      ]),
      gl.STATIC_DRAW
    );
  }

  #createProgramForPass(passIndex) {
    const gl = this.gl;

    const vertexSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fragmentSource = this.#makeFragmentShaderSource(passIndex);

    const vs = this.#compileShader(gl.VERTEX_SHADER, vertexSource);
    const fs = this.#compileShader(gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || 'Erreur de link WebGL';
      gl.deleteProgram(program);
      throw new Error(info);
    }

    return program;
  }

  #compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || 'Erreur de compilation shader';
      gl.deleteShader(shader);
      throw new Error(`${info}\n\nSource compilée:\n${source}`);
    }

    return shader;
  }

  #makeFragmentShaderSource() {
    const isf = this.currentISF;
    const inputs = Array.isArray(isf.metadata?.INPUTS) ? isf.metadata.INPUTS : [];
    const passes = Array.isArray(isf.metadata?.PASSES) ? isf.metadata.PASSES : [];

    const inputUniforms = inputs
      .map((input) => {
        switch (input.TYPE) {
          case 'float':
          case 'long':
          case 'int':
          case 'bool':
            return `uniform float ${input.NAME};`;
          case 'color':
            return `uniform vec4 ${input.NAME};`;
          case 'point2D':
            return `uniform vec2 ${input.NAME};`;
          case 'image':
            return `uniform sampler2D ${input.NAME};`;
          default:
            return '';
        }
      })
      .join('\n');

    const passTargetUniforms = passes
      .filter((p) => p.TARGET)
      .map((p) => `uniform sampler2D ${p.TARGET};
uniform vec2 ${p.TARGET}Size;`)
      .join('\n');

    const shaderBody = this.#transpileShaderBody(isf.shaderBody);

    return `
      precision mediump float;
      varying vec2 v_uv;

      uniform vec2 RENDERSIZE;
      uniform float TIME;
      uniform float TIMEDELTA;
      uniform float FRAMEINDEX;
      uniform float PASSINDEX;
      uniform vec4 DATE;

      ${inputUniforms}
      ${passTargetUniforms}

      ${shaderBody}
    `;
  }

  #transpileShaderBody(source) {
    return source
      .replace(/\bisf_FragNormCoord\b/g, '(gl_FragCoord.xy / RENDERSIZE.xy)')
      .replace(
        /\bIMG_THIS_PIXEL\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g,
        'texture2D($1, gl_FragCoord.xy / RENDERSIZE.xy)'
      )
      .replace(
        /\bIMG_NORM_PIXEL\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([^)]+)\)/g,
        'texture2D($1, $2)'
      )
      .replace(
        /\bIMG_PIXEL\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([^)]+)\)/g,
        'texture2D($1, ($2) / RENDERSIZE.xy)'
      );
  }

  #collectUniforms(program) {
    const gl = this.gl;
    const uniforms = new Map();

    const baseUniforms = [
      'RENDERSIZE',
      'TIME',
      'TIMEDELTA',
      'FRAMEINDEX',
      'PASSINDEX',
      'DATE'
    ];

    for (const name of baseUniforms) {
      uniforms.set(name, gl.getUniformLocation(program, name));
    }

    for (const input of this.inputDefs) {
      uniforms.set(input.NAME, gl.getUniformLocation(program, input.NAME));
    }

    const passes = Array.isArray(this.currentISF?.metadata?.PASSES)
      ? this.currentISF.metadata.PASSES
      : [];

    for (const pass of passes) {
      if (!pass.TARGET) continue;
      uniforms.set(pass.TARGET, gl.getUniformLocation(program, pass.TARGET));
      uniforms.set(`${pass.TARGET}Size`, gl.getUniformLocation(program, `${pass.TARGET}Size`));
    }

    uniforms._nextTexUnit = 0;
    return uniforms;
  }

  #bindBuiltins(uniforms, width, height, timeSec, deltaSec, passIndex) {
    const gl = this.gl;
    const now = new Date();
    const secondsToday =
      now.getHours() * 3600 +
      now.getMinutes() * 60 +
      now.getSeconds() +
      now.getMilliseconds() / 1000;

    const uRenderSize = uniforms.get('RENDERSIZE');
    const uTime = uniforms.get('TIME');
    const uTimeDelta = uniforms.get('TIMEDELTA');
    const uFrameIndex = uniforms.get('FRAMEINDEX');
    const uPassIndex = uniforms.get('PASSINDEX');
    const uDate = uniforms.get('DATE');

    if (uRenderSize) gl.uniform2f(uRenderSize, width, height);
    if (uTime) gl.uniform1f(uTime, timeSec);
    if (uTimeDelta) gl.uniform1f(uTimeDelta, deltaSec);
    if (uFrameIndex) gl.uniform1f(uFrameIndex, this.frameIndex);
    if (uPassIndex) gl.uniform1f(uPassIndex, passIndex);
    if (uDate) gl.uniform4f(uDate, now.getFullYear(), now.getMonth() + 1, now.getDate(), secondsToday);
  }

  #bindInputUniforms(uniforms) {
    const gl = this.gl;
    let texUnit = 0;

    for (const input of this.inputDefs) {
      const loc = uniforms.get(input.NAME);
      if (!loc) continue;

      const value = this.inputValues.get(input.NAME);

      switch (input.TYPE) {
        case 'float':
        case 'long':
        case 'int':
        case 'bool':
          gl.uniform1f(loc, Number(value ?? 0));
          break;
        case 'color': {
          const c = Array.isArray(value) ? value : [1, 1, 1, 1];
          gl.uniform4f(loc, c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1);
          break;
        }
        case 'point2D': {
          const p = Array.isArray(value) ? value : [0.5, 0.5];
          gl.uniform2f(loc, p[0] ?? 0.5, p[1] ?? 0.5);
          break;
        }
        case 'image': {
          const tex = this.imageTextures.get(input.NAME) || this.externalImageTextures.get(input.NAME);
          if (tex) {
            gl.activeTexture(gl.TEXTURE0 + texUnit);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(loc, texUnit);
            texUnit += 1;
          }
          break;
        }
        default:
          break;
      }
    }

    uniforms._nextTexUnit = texUnit;
  }

  #bindPassTextures(uniforms) {
    const gl = this.gl;
    let texUnit = uniforms._nextTexUnit || 0;

    for (const [name, target] of this.namedTargets.entries()) {
      const loc = uniforms.get(name);
      if (!loc) continue;

      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.uniform1i(loc, texUnit);

      const sizeLoc = uniforms.get(`${name}Size`);
      if (sizeLoc) {
        gl.uniform2f(sizeLoc, target.width || 1, target.height || 1);
      }

      texUnit += 1;
    }

    for (const [name, pair] of this.persistentTargets.entries()) {
      const loc = uniforms.get(name);
      if (!loc) continue;

      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, pair.read.texture);
      gl.uniform1i(loc, texUnit);

      const sizeLoc = uniforms.get(`${name}Size`);
      if (sizeLoc) {
        gl.uniform2f(sizeLoc, pair.read.width || 1, pair.read.height || 1);
      }

      texUnit += 1;
    }
  }

  #createTextureFromImage(image) {
    const gl = this.gl;
    const tex = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    return tex;
  }
}
