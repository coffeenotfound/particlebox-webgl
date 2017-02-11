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
	
	mouseButtonStates: new Array(3),
	
	universe: null,
	
	init: function() {
		var self = this;
		
		// create stats panel
		this.statsjs = new Stats();
		this.statsjs.showPanel(0);
		document.body.appendChild(this.statsjs.dom);
		
		{ // build dat.gui
			this.datGUI = new dat.GUI();
			this.datGUI.myvars = {};
			var gui = this.datGUI;
			gui.close();
			
			// folder: particles
			var folderParticles = gui.addFolder('Particles');
			folderParticles.open();
			
			// particleCount
			gui.myvars.particleCount = 1048576;
			folderParticles.add(gui.myvars, 'particleCount', [1, 4096, 16384, 262144, 1048576, 2097152, 268435456]);
			
			// particleFormation
			gui.myvars.particleFormation = 'random';
			folderParticles.add(gui.myvars, 'particleFormation', ['random', 'gaussian', 'uniform', 'circle', 'square']);
			
			// resetParticles
			gui.myvars.resetParticles = function() {
				alert('not implemented yet');
			};
			folderParticles.add(gui.myvars, 'resetParticles');
			
			// folder: simulation
			var folderSimulation = gui.addFolder('Simulation');
			folderSimulation.open();
			
			// mouseGravityStrength
			gui.myvars.mouseGravityStrength = 3000.0;
			gui.myvars.mouseLeftGravityStrength = 8000.0;
			gui.myvars.mouseRightGravityStrength = -16000.0;
			folderSimulation.add(gui.myvars, 'mouseGravityStrength').step(100);
			folderSimulation.add(gui.myvars, 'mouseLeftGravityStrength').step(100);
			folderSimulation.add(gui.myvars, 'mouseRightGravityStrength').step(100);
			
			gui.myvars.dragFactor = 0.995;
			folderSimulation.add(gui.myvars, 'dragFactor').step(0.005).min(0.0).max(1.0);
			
			// folder: render
			var folderRender = gui.addFolder('Render');
			folderRender.open();
			
			// particleSize
			gui.myvars.particleSize = 1.0;
			folderRender.add(gui.myvars, 'particleSize').min(1).max(8).step(0.5);
			
			// particleColor
			gui.myvars.particleColor = [255, 255, 255, 0.1];
			folderRender.addColor(gui.myvars, 'particleColor');
		}
		
		// create webgl context
		this.gl = NebGL.createGLForId("webglcanvas", { fullwindow: true, depth: false, alpha: false, antialias: false });
		
		// create extensions
		this.gl.OESTextureFloat = this.gl.getExtension("OES_texture_float");
		this.gl.OESTextureHalfFloat = this.gl.getExtension("OES_texture_half_float");
		//this.gl.WEBGLColorBufferFloat = this.gl.getExtension("WEBGL_color_buffer_float"); // not supported till webgl2
		
		this.gl.getExtension("EXT_color_buffer_float");
		
		// create the particle universe
		this.universe = new Particlebox.Universe(this.gl);
		
		// create vertexid buffer
		//var vertexIDBufferData = new Int32Array(16384 * 1024);
		var vertexIDBufferData = new Float32Array(16384 * 64);
		for(var i = 0; i < vertexIDBufferData.length; i++) {
			vertexIDBufferData[i] = i;
		}
		this.vertexIDBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexIDBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, vertexIDBufferData, this.gl.STATIC_DRAW);
		
		// create compute quad buffer
		this.computeQuadBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.computeQuadBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([-1,-1, -1,+1, +1,-1,  +1,-1, -1,+1, +1,+1]), this.gl.STATIC_DRAW);
		
		// load shaders
		this.shaderParticleCompute = NebGL.createProgramFromScripts(this.gl, "shader-particle-compute-vert", "shader-particle-compute-frag");
		this.shaderParticleCompute.uParticlePageSize = this.gl.getUniformLocation(this.shaderParticleCompute, "uParticlePageSize");
		this.shaderParticleCompute.uParticleMass = this.gl.getUniformLocation(this.shaderParticleCompute, "uParticleMass");
		this.shaderParticleCompute.uParticleDragFactor = this.gl.getUniformLocation(this.shaderParticleCompute, "uParticleDragFactor");
		
		this.shaderParticleDraw = NebGL.createProgramFromScripts(this.gl, "shader-particle-draw-vert", "shader-particle-draw-frag");
		this.shaderParticleDraw.uMatMVP = this.gl.getUniformLocation(this.shaderParticleDraw, "uMatMVP");
		this.shaderParticleDraw.uParticleColor = this.gl.getUniformLocation(this.shaderParticleDraw, "uParticleColor");
		this.shaderParticleDraw.uParticleSize = this.gl.getUniformLocation(this.shaderParticleDraw, "uParticleSize");
		this.shaderParticleDraw.uParticlePageSize = this.gl.getUniformLocation(this.shaderParticleDraw, "uParticlePageSize");
		
		// mouse move handler
		this.gl.canvas.addEventListener('mousemove', function(e) {
			self.universe.mouseGravitySource.posx = e.clientX;
			self.universe.mouseGravitySource.posy = e.clientY;
		}, false);
		
		// touch move handler
		this.gl.canvas.addEventListener("touchmove", function(e) {
			if(e.touches && e.touches.length > 0) {
				var touch = e.touches[0];
				
				self.universe.mouseGravitySource.posx = touch.clientX;
				self.universe.mouseGravitySource.posy = touch.clientY;
			}
		}, false);
		
		// mouse button handler
		this.gl.canvas.addEventListener('mousedown', function(e) {
			var button = e.button;
			if(button >= 0 && button <= 2) {
				self.mouseButtonStates[button] = true;
			}
		}, false);
		this.gl.canvas.addEventListener('mouseup', function(e) {
			var button = e.button;
			if(button >= 0 && button <= 2) {
				self.mouseButtonStates[button] = false;
			}
		}, false);
		
		// prevent context menu
		this.gl.canvas.oncontextmenu = function(e) {
			e.preventDefault();
		};
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
		
		var texIndexToCompute = this._tick % 2;
		
		// setup state
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.disable(gl.BLEND);
		
		// TODO: move this out of the draw method
		// update values
		universe.mouseGravitySource.strength = this.datGUI.myvars.mouseGravityStrength;
		if(particlebox.mouseButtonStates[0]) {
			universe.mouseGravitySource.strength = this.datGUI.myvars.mouseLeftGravityStrength;
		}
		else if(particlebox.mouseButtonStates[2]) {
			universe.mouseGravitySource.strength = this.datGUI.myvars.mouseRightGravityStrength;
		}
		
		{ // compute particles
			var page = universe.particleBuffer.page;
			
			// bind shader
			gl.useProgram(this.shaderParticleCompute);
			
			// update uniforms
			gl.uniform2f(this.shaderParticleCompute.uParticlePageSize, universe.particleBuffer.page.pageWidth, universe.particleBuffer.page.pageHeight);
			
			for(var i = 0; i < universe.gravitySources.length; i++) {
				var gs = universe.gravitySources[i];
				
				gl.uniform2f(gl.getUniformLocation(this.shaderParticleCompute, "uGravitySources[" + i + "].pos"), gs.posx, gs.posy);
				gl.uniform1f(gl.getUniformLocation(this.shaderParticleCompute, "uGravitySources[" + i + "].strength"), gs.strength);
			}
			
			gl.uniform1f(this.shaderParticleCompute.uParticleMass, universe.particleMass);
			gl.uniform1f(this.shaderParticleCompute.uParticleDragFactor, this.datGUI.myvars.dragFactor)
			
			// bind old source tex
			gl.bindTexture(gl.TEXTURE_2D, (texIndexToCompute == 0 ? page.tex2 : page.tex1));
			
			// bind new tex framebuffer
			gl.bindFramebuffer(gl.FRAMEBUFFER, (texIndexToCompute == 0 ? page.texFBO1 : page.texFBO2));
			
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
			gl.uniform1f(this.shaderParticleDraw.uParticleSize, 1.0);
			gl.uniform4f(this.shaderParticleDraw.uParticleColor, 0.96, 0.20, 0.20, 0.1);
			
			gl.uniform2f(this.shaderParticleDraw.uParticlePageSize, universe.particleBuffer.page.pageWidth, universe.particleBuffer.page.pageHeight);
			
			this.matrixMVP.identity().ortho(0, gl.canvas.width, gl.canvas.height, 0, 1, -1);
			gl.uniformMatrix4fv(this.shaderParticleDraw.uMatMVP, false, this.matrixMVP);
			
			// bind backbuffer and set viewport
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
			
			// clear
			gl.clear(gl.COLOR_BUFFER_BIT);
			
			// enable blend
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			
			// bind vertexid attrib
			gl.enableVertexAttribArray(0);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIDBuffer);
			gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0); // no integer attributes because webgl is stupid
			
			// bind newly computed particle data texture
			//gl.uniform1i(gl.getUniformLocation(this.shaderParticleDraw, "uTexParticleData"), 0);
			gl.bindTexture(gl.TEXTURE_2D, (texIndexToCompute == 0 ? universe.particleBuffer.page.tex1 : universe.particleBuffer.page.tex2));
			
			// draw the particles
			var particlesToDraw = universe.particleBuffer.page.particleNum;
			
			gl.drawArrays(gl.POINTS, 0, particlesToDraw);
			
			// reset state
			gl.disable(gl.BLEND);
		}
		
		// increment tick counter
		this._tick++;
	},
};


Particlebox.Universe = function(gl) {
	this.gl = gl;
	
	// create particlebuffer
	this.particleBuffer = new Particlebox.ParticleBuffer(this.gl);
	
	// init buffers
	this.setParticleNum(this._particleNum);
	
	// generate random gravity sources
	for(var i = 0; i < this.MAX_GRAVITY_SOURCES; i++) {
		//var gs = new Particlebox.GravitySource(Math.random()*1024, Math.random()*1024, (Math.random()*400)+100);
		var gs = new Particlebox.GravitySource(Math.random()*1024, Math.random()*1024, 0.0);
		this.gravitySources[i] = gs;
	}
	
	// set mouse gravity source
	this.mouseGravitySource = this.gravitySources[0];
};
Particlebox.Universe.prototype = {
	gl: null,
	
	particleBuffer: null,
	
	MAX_GRAVITY_SOURCES: 8,
	mouseGravitySource: null,
	gravitySources: [],
	particleMass: 0.001,
	
	_particleNum: 16384 * 32,
	//_particleNum: 4096,
	
	setParticleNum: function(particleNum) {
		this._particleNum = particleNum;
		
		// resize particle buffer
		this.particleBuffer.resize(this._particleNum);
	},
};


Particlebox.GravitySource = function(posx, posy, strength) {
	this.posx = posx;
	this.posy = posy;
	this.strength = strength;
};
Particlebox.GravitySource.prototype = {
	posx: -1,
	posy: -1,
	strength: -1,
};


/**
 * <del>Layout: each particle data is stored as 4 (or however big the data is) sequential pixels, representing the x and y pos accordingly</del>
 * Each particle is one RGBA32F pixel. As each pixel is processed seperately, it's easier and faster to have all
 * the particle data at once instead of calculating the distance to the gravity point twice per particle.
 */
Particlebox.ParticleBuffer = function(gl) {
	this.gl = gl;
	
	// query max texture size
	this.MAX_TEXTURE_SIZE = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
	
	// create page
	this.page = new Particlebox.ParticleBuffer.DataPage(this);
};
Particlebox.ParticleBuffer.prototype = {
	MAX_TEXTURE_SIZE: -1,
	
	gl: null,
	
	page: null,
	particleNum: -1,
	
	resize: function(newParticleNum) {
		this.particleNum = newParticleNum;
		
		//DEBUG:
		this.page.resize(this.particleNum);
	},
};


/** a page (one tex) of particle data. actually consists of two textures for ping-ponging */
Particlebox.ParticleBuffer.DataPage = function(particleBuffer) {
	this.particleBuffer = particleBuffer;
};
Particlebox.ParticleBuffer.DataPage.prototype = {
	particleBuffer: null,
	
	tex1: null,
	tex2: null,
	texFBO1: null,
	texFBO2: null,
	
	particleNum: -1,
	
	pageWidth: -1,
	pageHeight: -1,
	
	resize: function(particleNum) {
		this.particleNum = particleNum;
		
		// calc size
		this.pageWidth = this.particleBuffer.MAX_TEXTURE_SIZE;
		//this.pageHeight = Math.ceil(this.particleNum / this.pageWidth);
		this.pageHeight = Math.max(1, Math.pow(2, Math.ceil(Math.log2(this.particleNum / this.pageWidth))));
		//this.pageHeight = 1;
		
		var gl = this.particleBuffer.gl;
		
		var randn_bm = function() {
			var u = 1 - Math.random(); // Subtraction to flip [0, 1) to (0, 1].
			var v = 1 - Math.random();
			return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
		}
		
		// create random particle positions
		var initialParticleData = new Float32Array(this.pageWidth * this.pageHeight * 4);
		for(var i = 0; i < initialParticleData.length; i += 4) {
			//initialParticleData[i + 0] = Math.random()*this.particleBuffer.gl.canvas.width;
			//initialParticleData[i + 1] = Math.random()*this.particleBuffer.gl.canvas.height;
			initialParticleData[i + 0] = ((randn_bm()+4.0)*0.125)*this.particleBuffer.gl.canvas.width;
			initialParticleData[i + 1] = ((randn_bm()+4.0)*0.125)*this.particleBuffer.gl.canvas.height;
			
			//initialParticleData[i + 2] = 0;
			//initialParticleData[i + 3] = 0;
			//initialParticleData[i + 2] = (Math.random()*2)-1;
			//initialParticleData[i + 3] = (Math.random()*2)-1;
		}
		
		// create textures
		if(!this.tex1) {
			this.tex1 = gl.createTexture();
			this.tex2 = gl.createTexture();
		}
		
		var internalFormat = gl.RGBA32F;
		//var internalFormat = gl.RGBA8;
		
		// allocate textures
		gl.bindTexture(gl.TEXTURE_2D, this.tex1);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		//gl.texImage2D(gl.TEXTURE_2D, 0, gl.WEBGLColorBufferFloat.RGBA32F_EXT, this.pageWidth, this.pageHeight, 0, gl.RGBA, gl.FLOAT, initialParticleData);
		//gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.pageWidth, this.pageHeight, 0, gl.RGBA, gl.OESTextureHalfFloat.HALF_FLOAT_OES, initialParticleData);
		gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, this.pageWidth, this.pageHeight, 0, gl.RGBA, gl.FLOAT, initialParticleData);
		
		gl.bindTexture(gl.TEXTURE_2D, this.tex2);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		//gl.texImage2D(gl.TEXTURE_2D, 0, gl.WEBGLColorBufferFloat.RGBA32F_EXT, this.pageWidth, this.pageHeight, 0, gl.RGBA, gl.FLOAT, initialParticleData);
		//gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.pageWidth, this.pageHeight, 0, gl.RGBA, gl.OESTextureHalfFloat.HALF_FLOAT_OES, initialParticleData);
		gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, this.pageWidth, this.pageHeight, 0, gl.RGBA, gl.FLOAT, initialParticleData);
		
		// create framebuffers
		if(!this.texFBO1) {
			this.texFBO1 = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.texFBO1);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex1, 0);
			
			this.texFBO2 = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.texFBO2);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex2, 0);
		}
		
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	},
};
