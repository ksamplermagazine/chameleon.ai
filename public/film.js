// Browser film look (WebGL). Defaults mirror the tested ComfyUI workflow:
// ExposureAdjust -> FXTD_RadianceGradeApply -> RadianceGrade -> LayerFilter: FilmV2
// -> RadianceFilmGrain -> ColorMatchV2. These are approximations, not the same node code.

export const DEFAULTS = {
  exposure: 0,        // internal: 0 after AI restore, +1.5 for the browser-only preview
  fade: 0, contrast: 1, highlights: 0, saturation: 1, filmic: 0, split: 0, vignette: 0, // neutral
  grain: 0.6,         // RadianceFilmGrain intensity from the workflow
  grainSize: 1.2,
  match: 0.75         // color match strength (applies once a reference photo is added)
};

const VERT = `attribute vec2 p; varying vec2 uv;
void main(){ uv = vec2(p.x*.5+.5, .5-p.y*.5); gl_Position = vec4(p,0.,1.); }`;

const FRAG = `precision highp float;
varying vec2 uv; uniform sampler2D img; uniform vec2 res;
uniform float exposure, fade, contrast, highlights, saturation, filmic, split, vignette, grain, grainSize, match;
uniform vec3 mScale, mOffset;
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c){ return pow(max(c,0.), vec3(1./2.2)); }
float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec3 c = texture2D(img, uv).rgb;
  vec3 l = toLin(c);
  if (exposure != 0.) {
    float w = exp2(exposure);
    l *= w;
    if (exposure > 0.) l = l*(1.+l/(w*w))/(1.+l); // extended Reinhard: keeps highlights from clipping
  }
  l = .18*pow(max(l,1e-5)/.18, vec3(contrast));
  float y = luma(l);
  l *= mix(1., 1.+highlights, smoothstep(.35, 1., y));
  l = mix(l, aces(l*1.2), filmic);
  c = toSrgb(l);
  c = fade + c*(1.-fade);
  vec3 lift = vec3(.01,.01,.025)*split, gain = mix(vec3(1.), vec3(1.03,1.,.96), split);
  c = c*gain + lift*(1.-c);
  c = mix(vec3(luma(c)), c, saturation);
  vec2 d = uv-.5; d.x *= res.x/res.y;
  c *= 1. - vignette*smoothstep(.2, .9, length(d));
  vec2 g = floor(uv*res/grainSize);
  float n = (hash(g)+hash(g+17.3)-1.);
  float w = mix(.6, .2, luma(c));
  c += n*grain*.12*w;
  c = mix(c, c*mScale + mOffset, match);
  gl_FragColor = vec4(clamp(c,0.,1.), 1.);
}`;

export function createFilm(canvas) {
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) throw Error('WebGL is not available in this browser.');
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(o)); return o; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const u = n => gl.getUniformLocation(prog, n);
  let matchAffine = { scale: [1, 1, 1], offset: [0, 0, 0] };

  return {
    maxSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    setImage(src) {
      canvas.width = src.width; canvas.height = src.height;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    },
    setReference(src, ref) { matchAffine = colorMatch(stats(src), stats(ref)); },
    render(s) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u('res'), canvas.width, canvas.height);
      for (const k of Object.keys(DEFAULTS)) gl.uniform1f(u(k), s[k]);
      gl.uniform3fv(u('mScale'), matchAffine.scale); gl.uniform3fv(u('mOffset'), matchAffine.offset);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };
}

// Per-channel mean/std transfer (simple Reinhard-style match, approximates ColorMatchV2).
function stats(img) {
  const c = document.createElement('canvas'), s = 256 / Math.max(img.width, img.height);
  c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data, n = d.length / 4;
  const m = [0, 0, 0], v = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k] += d[i + k] / 255;
  m.forEach((_, k) => m[k] /= n);
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) v[k] += (d[i + k] / 255 - m[k]) ** 2;
  return { mean: m, std: v.map(x => Math.sqrt(x / n) || 1e-3) };
}
function colorMatch(src, ref) {
  const scale = [0, 1, 2].map(k => ref.std[k] / src.std[k]);
  return { scale, offset: [0, 1, 2].map(k => ref.mean[k] - src.mean[k] * scale[k]) };
}
