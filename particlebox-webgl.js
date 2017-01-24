$(function() {
	// create particlebox
	var particlebox = new Particlebox();
	window.particlebox = particlebox;
	
	// init
	particlebox.init();
	
	// main loop
	var animate = function() {
		// request next frame
		requestAnimationFrame(animate);
		
		// process particlebox
		particlebox.frame();
	};
	requestAnimationFrame(animate);
});


var Particlebox = function() {};
Particlebox.prototype = {
	gl: null,
	
	universe: null,
	
	init: function() {
		// create stats panel
		this.statsjs = new Stats();
		this.statsjs.showPanel(0);
		document.body.appendChild(this.statsjs.dom);
		
		// create webgl context
		this.gl = NebGL.createGLForId("webglcanvas", { fullwindow: true, depth: true, alpha: false });
		
		// create extensions
		//this.gl.OESTextureHalfFloat = this.gl.getExtension("OES_texture_half_float");
		this.gl.WEBGLColorBufferFloat = this.gl.getExtension("WEBGL_color_buffer_float");
		
		// create the particle universe
		this.universe = new Particlebox.Universe(this.gl);
		
		// create vertexid buffer
		this.vertexIDBuffer = this.gl.createBuffer();
		var vertexIDBufferData = new Int32Array(16384 * 16384);
		for(var i = 0; i < vertexIDBufferData.length; i++) {
			vertexIDBufferData[i] = i;
		}
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexIDBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, vertexIDBufferData, this.gl.STATIC_DRAW);
		
		// create compute quad buffer
		this.computeQuadBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.computeQuadBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32([-1,-1, -1,+1, +1,-1,  +1,-1, -1,+1, +1,+1]), this.gl.STATIC_DRAW);
		
		// load shaders
		this.shaderParticleCompute = NebGL.createProgramFromScripts(this.gl, "shader-particle-compute-vert", "shader-particle-compute-frag");
		
		this.shaderParticleDraw = NebGL.createProgramFromScripts(this.gl, "shader-particle-draw-vert", "shader-particle-draw-frag");
		this.shaderParticleDraw.uMatMVP = this.gl.getUniformLocation(this.shaderParticleDraw, "uMatMVP");
		this.shaderParticleDraw.uParticleColor = this.gl.getUniformLocation(this.shaderParticleDraw, "uParticleColor");
		this.shaderParticleDraw.uParticleSize = this.gl.getUniformLocation(this.shaderParticleDraw, "uParticleSize");
		this.shaderParticleDraw.uParticlePageWidth = this.gl.getUniformLocation(this.shaderParticleDraw, "uParticlePageWidth");
	},
	
	frame: function() {
		this.statsjs.begin();
		
		this.draw();
		
		this.statsjs.end();
	},
	
	_tick: 0,
	vertexIDBuffer: null,
	computeQuadBuffer: null,
	
	shaderParticleCompute: null,
	shaderParticleDraw: null,
	
	matrixMVP: new Mat4(),
	
	draw: function() {
		var gl = this.gl;
		var universe = this.universe;
		
		// clear
		gl.clear(gl.COLOR_BUFFER_BIT);
		
		var texIndexToCompute = this._tick % 2;
		
		{ // compute particles
			var page = universe.particleBuffer.page;
			
			// bind shader
			gl.useProgram(this.shaderParticleCompute);
			
			// bind old source tex
			gl.bindTexture(gl.TEXTURE_2D, (texIndexToCompute == 0 ? page.tex2 : page.tex1));
			
			// bind new tex framebuffer
			gl.bindTexture(gl.TEXTURE_2D, (texIndexToCompute == 0 ? page.texFBO1 : page.texFBO2));
			
			// set viewport (important as gl_FragCoord absolutely has to be correct for each particle)
			gl.viewport(0, 0, page.pageWidth, page.pageHeight);
			
			// bind computequadbuffer
			gl.bindBuffer(gl.ARRAY_BUFFER, this.computeQuadBuffer);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
			
			// call shader
			gl.drawArrays(gl.TRIANGLES, 0, 6);
		}
		
		{ // draw particles
			// bind shader
			gl.useProgram(this.shaderParticleDraw);
			
			// update uniforms
			gl.uniform1f(this.shaderParticleDraw.uParticleSize, 4.0);
			gl.uniform4f(this.shaderParticleDraw.uParticleColor, 1.0, 1.0, 1.0, 1.0);
			
			this.matrixMVP.identity().ortho(0, gl.canvas.width, gl.canvas.height, 0, 1, -1);
			gl.uniform4fv(this.shaderParticleDraw.uMatMVP, this.matrixMVP);
			
			// set viewport
			gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
			
			// bind vertexid attrib
			gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIDBuffer);
			gl.vertexAttribPointer(0, 1, gl.UNSIGNED_INT, false, 0, 0);
			
			// bind newly computed particle data texture
			gl.bindTexture(gl.TEXTURE_2D, (texIndexToCompute == 0 ? universe.particleBuffer.page.tex1 : universe.particleBuffer.page.tex2));
			
			// draw the particles
			var particlesToDraw = universe.particleBuffer.page.particleNum;
			
			gl.drawArrays(gl.POINTS, 0, particlesToDraw);
		}
		
		// increment tick counter
		this._tick++;
	},
};


Particlebox.Universe = function(gl) {
	this.gl = gl;
	
	// create particlebuffer
	this.particleBuffer = new Particlebox.ParticleBuffer(this.gl, this._particleNum);
	
	// init buffers
	this.setParticleNum(this._particleNum);
};
Particlebox.Universe.prototype = {
	gl: null,
	
	particleBuffer: null,
	
	_gravityPointX: 0.0,
	_gravityPointY: 0.0,
	_gravityStrength: 10.0,
	_particleMass: 1.0,
	_particleNum: 1024,
	
	setParticleNum: function(particleNum) {
		this._particleNum = particleNum;
		
		// resize particle buffer
		this.particleBuffer.resize(this._particleNum);
	},
};


/**
 * <del>Layout: each particle data is stored as 4 (or however big the data is) sequential pixels, representing the x and y pos accordingly</del>
 * Each particle is one RGBA32F pixel. As each pixel is processed seperately, it's easier and faster to have all
 * the particle data at once instead of calculating the distance to the gravity point twice per particle.
 */
Particlebox.ParticleBuffer = function(gl, particlenum) {
	this.gl = gl;
	this.particleNum = particlenum;
	
	// query max texture size
	this.MAX_TEXTURE_SIZE = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
	
	// create page
	this.page = new Particlebox.ParticleBuffer.DataPage(this, this.particleNum);
	this.page.resize(this.particleNum);
};
Particlebox.ParticleBuffer.prototype = {
	MAX_TEXTURE_SIZE: -1,
	
	gl: null,
	
	page: null,
	particleNum: -1,
	
	resize: function(newParticleNum) {
		this.particleNum = newParticleNum;
		
		//DEBUG:
		page.resize(newParticleNum);
	},
};


/** a page (one tex) of particle data. actually consists of two textures for ping-ponging */
Particlebox.ParticleBuffer.DataPage = function(particleBuffer, particleNum) {
	this.particleBuffer = particleBuffer;
	this.particleNum = particleNum;
};
Particlebox.ParticleBuffer.DataPage.prototype = {
	particleBuffer: null,
	
	tex1: null,
	tex2: null,
	
	particleNum: -1,
	
	pageWidth: -1,
	pageHeight: -1,
	
	resize: function(particleNum) {
		this.particleNum = particleNum;
		
		// calc size
		this.pageWidth = this.particleBuffer.MAX_TEXTURE_SIZE;
		this.pageHeight = Math.ceil(this.particleNum / this.pageWidth);
		
		var gl = this.particleBuffer.gl;
		
		// create textures
		if(!this.tex1) {
			this.tex1 = gl.createTexture();
			this.tex2 = gl.createTexture();
		}
		
		// create random particle positions
		var initialParticleData = new Float32Array(this.pageWidth * this.pageHeight * 4);
		for(var i = 0; i < initialParticleData.length; i += 4) {
			initialParticleData[i + 0] = Math.random() * 512;
			initialParticleData[i + 1] = Math.random() * 512;
			initialParticleData[i + 2] = 0;
			initialParticleData[i + 3] = 0;
		}
		
		// allocate textures
		gl.bindTexture(gl.TEXTURE_2D, this.tex1);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.WEBGLColorBufferFloat.RGBA32F_EXT, this.pageWidth, this.pageHeight, 0, gl.RGBA, gl.FLOAT, initialParticleData);
		
		gl.bindTexture(gl.TEXTURE_2D, this.tex2);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.WEBGLColorBufferFloat.RGBA32F_EXT, this.pageWidth, this.pageHeight, 0, gl.RGBA, gl.FLOAT, initialParticleData);
	},
};
