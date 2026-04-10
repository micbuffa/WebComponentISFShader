// This class is responsible for rendering the video frames sent by the plugins on a canvas. It uses WebGL to render the video frames efficiently.
// The parameters are :
// gl = the WebGL context to render the video frames on the canvas. 
//  It is passed by the host page when it creates the CanvasRenderer, and it is used by the plugins to render the video frames on the canvas.
// program = the WebGL program that is used to render the video frames. 
// It is created in the setup() method of the CanvasRenderer, and it is used by the plugins to render the video frames on the canvas.
// name = the name of the uniform variable in the shader that is used to pass the video frames to the shader.
//        gl.getUniformLocation( program, name ); 
// suffix = the suffix of the uniform function that is used to set the value of the uniform variable in the shader.
class Uniform {
    constructor(gl, program, name, suffix) {
        this.gl = gl
        this.program = program
        this.name = name;
        this.suffix = suffix;
        this.location = gl.getUniformLocation( program, name );
        if (this.location == -1) {
            throw new Error("Passed name didn't correspond to an active attribute in the specified program.")
        }
        console.log(`var ${name} location ${this.location}`)
    }

    // the set() method is used to set the value of the uniform variable in the shader.
    set(...values) {
        var method = 'uniform' + this.suffix;
        var args = [ this.location ].concat( values );
        // @ts-ignore
        this.gl[ method ].apply( this.gl, args );
    }
}

// ----- Rect ----- //

// This class is used to render a rectangle on the canvas. It is used by the CanvasRenderer to render the video frames sent by the plugins on the canvas.
// The rectangle is rendered as a triangle strip, which is a way to render a rectangle with two triangles. 
// The vertices of the rectangle are defined in the constructor, and the render() method is used to render the rectangle on the canvas.
class Rect {
    constructor(gl) {
        this.gl = gl
        this.buffer = gl.createBuffer();
        gl.bindBuffer( gl.ARRAY_BUFFER, this.buffer );
        this.verts = new Float32Array([
            -1, -1,
            1, -1,
            -1,  1,
            1,  1,
        ]);
        gl.bufferData( gl.ARRAY_BUFFER, this.verts, gl.STATIC_DRAW );
    }

    render() {
        this.gl.drawArrays( this.gl.TRIANGLE_STRIP, 0, 4 );
    }

}

class CanvasRenderer {
    

    constructor(canvas) {
        this.canvas = canvas

        this.gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl")

        this.setup(this.gl)
    }

    setup(gl) {
        console.log("CanvasRenderer: Calling setup")

        // create program
        var program = gl.createProgram();
        if (program == null) {
            return
        }
        this.program = program

        // add shaders
        var vertexShaderSource = this.vertexShader()
        var fragmentShaderSource = this.fragmentShader()

        this.addShader( vertexShaderSource, gl.VERTEX_SHADER );
        this.addShader( fragmentShaderSource, gl.FRAGMENT_SHADER );

        // link & use program
        gl.linkProgram( program );
        gl.useProgram( program );

        // create fragment uniforms
        this.uResolution = new Uniform( gl, program, 'u_resolution', '2f' );

        // create position attrib
        this.billboard = new Rect( gl );
        //gl.bindTexture(gl.TEXTURE_2D, this.input);

        this.positionLocation = this.gl.getAttribLocation( this.program, 'a_position' );
        
        if (this.positionLocation < 0) {
            console.error("positionLocation returned ", this.positionLocation)
        }

        this.resize();

        console.log("finished setup")
    }

    render(input) {
        this.gl.useProgram( this.program );
        this.gl.bindTexture(this.gl.TEXTURE_2D, input)

        this.gl.bindBuffer( this.gl.ARRAY_BUFFER, this.billboard.buffer );

        this.gl.enableVertexAttribArray( this.positionLocation );
        this.gl.vertexAttribPointer( this.positionLocation, 2, this.gl.FLOAT, false, 0, 0 );

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

        this.billboard.render();

        this.gl.bindTexture(this.gl.TEXTURE_2D, null)
        this.gl.useProgram( null ); 

    }
        
    // ----- resize ----- //    
    resize() {
        var width = 640
        var height = 480

        this.uResolution.set( width, height );
        this.gl.viewport( 0, 0, width, height );
    }

    addShader(source, type) {
        let gl = this.gl
        var shader = gl.createShader( type );
        if (shader == null) {
            throw new Error( 'createShader returned null' );
        }
        gl.shaderSource( shader, source );
        gl.compileShader( shader );
        var isCompiled = gl.getShaderParameter( shader, gl.COMPILE_STATUS );
        if ( !isCompiled ) {
          throw new Error( 'Shader compile error: ' + gl.getShaderInfoLog( shader ) );
        }
        gl.attachShader(this.program, shader );
    }


    vertexShader() {
        return `
attribute vec2 a_position;

void main() {
    gl_Position = vec4(a_position, 0, 1);
}
        `
    }

    fragmentShader() {
        return `
        precision mediump float;

uniform sampler2D texture;
uniform vec2 u_resolution;

void main() {
    vec2 pos = gl_FragCoord.xy / u_resolution;

    gl_FragColor = texture2D(texture, pos);
}
    `
    }
}

// export classes and functions for host page
export { CanvasRenderer }