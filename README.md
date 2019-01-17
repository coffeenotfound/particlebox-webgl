# ParticleBox WebGL

Little WebGL particle sandbox with fully gpu computed dynamic particles that easily pushes more than a million particles a frame.

It works by having particles stored as packed pixels in float textures. Each tick the textures are ping-pong'ed through a fragment shader that calculates the new positions.

This isn't fully optimal as particle data has to go through the full fragment pipeline. An alternate approach could be using transform feedback and a vertex shader to simulate the particles or using either float or buffer textures for the particle data and simulating them in a compute shader. Though transform feedback is only available in WebGL2 and compute shaders are not available at all currently.
