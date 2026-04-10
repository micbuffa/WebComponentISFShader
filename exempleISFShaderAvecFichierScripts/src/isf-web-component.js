import { parseISF } from './isf-parser.js';
import { ISFGUI } from './isf-gui.js';
import { ISFRenderer } from './isf-renderer.js';

export class ISFShaderRendererElement extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({ mode: 'open' });

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          color: #eee;
          font-family: system-ui, sans-serif;
        }

        .panel {
          display: grid;
          gap: 12px;
          padding: 12px;
          border-radius: 12px;
          border: 1px solid #333;
          background: #181818;
          box-sizing: border-box;
          max-width: 480px;
        }

        .row {
          display: grid;
          gap: 6px;
        }

        .row-inline {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
        }

        .range-wrap {
          display: grid;
          grid-template-columns: 1fr 90px;
          gap: 8px;
          align-items: center;
        }

        .point2d-wrap {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .gui {
          display: grid;
          gap: 10px;
        }

        .meta {
          font-size: 12px;
          opacity: 0.85;
        }

        select, input, button, textarea {
          box-sizing: border-box;
          width: 100%;
        }

        input[type="checkbox"] {
          width: auto;
        }

        input[type="color"] {
          height: 38px;
          padding: 0;
          background: transparent;
          border: 1px solid #444;
          border-radius: 8px;
        }

        button {
          cursor: pointer;
          border: 1px solid #444;
          background: #252525;
          color: #fff;
          border-radius: 8px;
          padding: 8px 10px;
        }

        textarea.console {
          min-height: 160px;
          resize: vertical;
          border-radius: 8px;
          border: 1px solid #444;
          background: #0b0b0b;
          color: #ff9a9a;
          padding: 8px;
          font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
          overflow: auto;
        }
      </style>

      <div class="panel">
        <div class="row">
          <label for="preset">Preset</label>
          <select id="preset"></select>
          <div class="meta" id="shaderMeta"></div>
        </div>

        <div class="gui" id="gui"></div>

        <div class="row-inline">
          <button id="reloadBtn" type="button">Recharger le shader</button>
          <button id="clearConsoleBtn" type="button">Effacer console</button>
        </div>

        <div class="row">
          <label for="console">Console</label>
          <textarea id="console" class="console" readonly></textarea>
        </div>
      </div>
    `;

    this.canvas = null;
    this.currentShaderURL = null;
    this.currentISF = null;
    this.upstreamNode = null;
    this.downstreamNode = null;
    this.upstreamInputName = null;
    this.animationFrame = null;
    this.running = false;

    this.presets = [
      { url: './shaders/Damier_Dynamique.fs' },
      { url: './shaders/Organic_Rainbow_Flow.fs' },
      { url: './shaders/Liquid_Aurora.fs' },
      { url: './shaders/Nebula_Feedback.fs' }
    ];

    this.$preset = this.shadowRoot.getElementById('preset');
    this.$gui = this.shadowRoot.getElementById('gui');
    this.$console = this.shadowRoot.getElementById('console');
    this.$shaderMeta = this.shadowRoot.getElementById('shaderMeta');
    this.$reloadBtn = this.shadowRoot.getElementById('reloadBtn');
    this.$clearConsoleBtn = this.shadowRoot.getElementById('clearConsoleBtn');

    this.renderer = new ISFRenderer({
      onLog: (msg) => this.log(msg)
    });

    this.gui = new ISFGUI({
      root: this.$gui,
      renderer: this.renderer,
      onLog: (msg) => this.log(msg)
    });
  }

  connectedCallback() {
    this.#readPresetsAttribute();
    this.#populatePresetMenu();

    this.$preset.addEventListener('change', () => {
      const url = this.$preset.value;
      this.loadShaderFromURL(url);
    });

    this.$reloadBtn.addEventListener('click', () => {
      if (this.currentShaderURL) {
        this.loadShaderFromURL(this.currentShaderURL);
      }
    });

    this.$clearConsoleBtn.addEventListener('click', () => {
      this.$console.value = '';
    });

    if (this.presets.length) {
      this.loadShaderFromURL(this.presets[0].url);
    }
  }

  disconnectedCallback() {
    this.#stopRenderLoop();
    this.renderer.stop();
  }

  connect(target, options = {}) {
    if (target instanceof HTMLCanvasElement) {
      this.#connectToCanvas(target);
      return target;
    }

    if (target instanceof ISFShaderRendererElement) {
      this.#connectToNode(target, options);
      return target;
    }

    throw new Error('connect(target) attend un HTMLCanvasElement ou un ISFShaderRendererElement');
  }

  #connectToCanvas(canvas) {
    this.downstreamNode = null;
    this.#updateOutputMode();

    this.#attachSharedOutput(canvas, null);

    if (this.currentISF) {
      this.renderer.setISF(this.currentISF);
    }

    this.#startRenderLoopIfTerminal();
  }

  #connectToNode(target, options = {}) {
    if (target === this) {
      throw new Error('Impossible de connecter un composant sur lui-même');
    }

    if (this.downstreamNode && this.downstreamNode !== target && this.downstreamNode.upstreamNode === this) {
      this.downstreamNode.upstreamNode = null;
      this.downstreamNode.upstreamInputName = null;
      this.downstreamNode.#updateOutputMode();
    }

    this.downstreamNode = target;
    target.#setUpstream(this, options.inputName || options.toInput || null);
    this.#updateOutputMode();

    if (target.canvas && target.renderer.gl) {
      this.#attachSharedOutput(target.canvas, target.renderer.gl);
    }

    this.#stopRenderLoop();
    target.#startRenderLoopIfTerminal();
  }

  #setUpstream(node, preferredInputName = null) {
    this.upstreamNode = node;
    this.upstreamInputName = this.#resolveUpstreamInputName(preferredInputName);
    this.#updateOutputMode();

    if (this.upstreamNode && this.upstreamInputName) {
      this.log(`Entrée chaînée: ${this.upstreamInputName}`);
    }
  }

  #attachSharedOutput(canvas, sharedGL) {
    this.canvas = canvas;

    if (sharedGL) {
      this.renderer.connect(canvas, { sharedGL });
    } else {
      this.renderer.connect(canvas);
    }

    const gl = this.renderer.gl;
    if (this.upstreamNode) {
      this.upstreamNode.#attachSharedOutput(canvas, gl);
    }
  }

  #resolveUpstreamInputName(preferredInputName = null) {
    const inputs = Array.isArray(this.currentISF?.metadata?.INPUTS) ? this.currentISF.metadata.INPUTS : [];
    const imageInputs = inputs.filter((input) => input.TYPE === 'image' && input.NAME);

    if (!imageInputs.length) {
      return null;
    }

    if (preferredInputName && imageInputs.some((input) => input.NAME === preferredInputName)) {
      return preferredInputName;
    }

    return imageInputs[0].NAME;
  }

  #updateOutputMode() {
    this.renderer.setOutputToTexture(Boolean(this.downstreamNode));
  }

  #startRenderLoopIfTerminal() {
    if (!this.canvas || this.downstreamNode) {
      this.#stopRenderLoop();
      return;
    }

    if (this.running) return;
    this.running = true;

    const tick = () => {
      if (!this.running) return;
      this.#renderChain();
      this.animationFrame = requestAnimationFrame(tick);
    };

    this.animationFrame = requestAnimationFrame(tick);
  }

  #stopRenderLoop() {
    this.running = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  #renderChain() {
    if (this.upstreamNode) {
      this.upstreamNode.#renderChain();

      if (this.upstreamInputName) {
        this.renderer.setExternalTextureInput(this.upstreamInputName, this.upstreamNode.renderer.getOutputTexture());
      }
    }

    this.renderer.render();
  }

  async loadShaderFromURL(url) {
    this.currentShaderURL = url;
    this.log(`Chargement shader: ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const source = await response.text();
      const isf = parseISF(source);

      this.currentISF = isf;
      this.#updateMeta(isf.metadata, url);

      this.renderer.setISF(isf);

      if (this.upstreamNode) {
        this.upstreamInputName = this.#resolveUpstreamInputName(this.upstreamInputName);

        if (!this.upstreamInputName) {
          this.log('Chaînage: aucun input image trouvé sur ce shader');
        }
      }

      const inputs = Array.isArray(isf.metadata?.INPUTS) ? isf.metadata.INPUTS : [];
      this.gui.buildFromInputs(inputs);

      this.log(`Shader chargé: ${isf.metadata?.NAME || this.#filenameToPresetName(url)}`);
    } catch (err) {
      this.log(`Erreur chargement: ${err.message}`);
    }
  }

  log(message) {
    const stamp = new Date().toLocaleTimeString();
    this.$console.value += `[${stamp}] ${message}\n`;
    this.$console.scrollTop = this.$console.scrollHeight;
  }

  #readPresetsAttribute() {
    const presetsAttr = this.getAttribute('presets');
    if (!presetsAttr) return;

    try {
      const parsed = JSON.parse(presetsAttr);
      if (Array.isArray(parsed) && parsed.length) {
        this.presets = parsed.map((entry) => ({
          url: entry.url,
          name: entry.name || this.#filenameToPresetName(entry.url)
        }));
      }
    } catch (err) {
      this.log(`Erreur parsing presets: ${err.message}`);
    }
  }

  #populatePresetMenu() {
    this.$preset.innerHTML = '';

    for (const preset of this.presets) {
      const option = document.createElement('option');
      option.value = preset.url;
      option.textContent = preset.name || this.#filenameToPresetName(preset.url);
      this.$preset.appendChild(option);
    }
  }

  #filenameToPresetName(url) {
    const file = url.split('/').pop() || url;
    return file.replace(/\.[^.]+$/, '');
  }

  #updateMeta(metadata, url) {
    const name = metadata?.NAME || this.#filenameToPresetName(url);
    const description = metadata?.DESCRIPTION || 'Sans description';
    const credit = metadata?.CREDIT ? ` — Crédit: ${metadata.CREDIT}` : '';
    this.$shaderMeta.textContent = `${name}: ${description}${credit}`;
  }
}

customElements.define('isf-shader-renderer', ISFShaderRendererElement);
