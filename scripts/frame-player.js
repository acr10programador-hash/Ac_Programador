class FramePlayer extends HTMLElement {
  constructor(){
    super();
    this._shadow = this.attachShadow({mode:'open'});
    this._wrapper = document.createElement('div');
    this._wrapper.className = 'frame-player-wrapper';
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d');
    this._wrapper.appendChild(this._canvas);

    this._loader = document.createElement('div');
    this._loader.className = 'fp-loader';
    this._loader.textContent = 'Cargando...';
    this._wrapper.appendChild(this._loader);

    const style = document.createElement('style');
    style.textContent = `:host{display:block;position:fixed;inset:0;width:100%;height:100vh;height:100dvh;z-index:-9999;pointer-events:none;overflow:hidden} .frame-player-wrapper{position:absolute;inset:0;width:100%;height:100%;overflow:hidden} canvas{display:block;width:100%;height:100%} .fp-loader{position:absolute;left:12px;top:12px;background:rgba(0,0,0,0.6);color:#fff;padding:6px 8px;border-radius:6px;font-size:13px}`;
    this._shadow.appendChild(style);
    this._shadow.appendChild(this._wrapper);

    this._images = [];
    this._loaded = new Set();
    this._lastDrawn = -1;
    this._ticking = false;
    this._rafId = 0;
    this._onScroll = this._onScroll.bind(this);
    this._onResize = this._onResize.bind(this);
    this._animate = this._animate.bind(this);
  }

  connectedCallback(){
    this.base = this.getAttribute('data-base') || 'frames de animacion/ezgif-frame-';
    this.count = parseInt(this.getAttribute('data-count')|| '1',10);
    this.pad = parseInt(this.getAttribute('data-pad')|| '3',10);
    this.ext = this.getAttribute('data-ext') || '.jpg';

    // ensure host occupies full viewport so the canvas can be used as fullscreen background
    // do not set an inline height that limits the host — let :host CSS control sizing
    this.style.removeProperty('height');
    this._resizeCanvas();

    // load first frame immediately and draw when ready
    this._loadImage(0, true);

    // light initial prefetch
    this._preloadInitial(6);

    window.addEventListener('scroll', this._onScroll, {passive:true});
    document.addEventListener('scroll', this._onScroll, {passive:true});
    window.addEventListener('resize', this._onResize);

    // draw current frame based on scroll
    this._onScroll();
    this._animate();
  }

  disconnectedCallback(){
    window.removeEventListener('scroll', this._onScroll);
    document.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onResize);
    if(this._rafId) cancelAnimationFrame(this._rafId);
  }

  _resizeCanvas(){
    const dpr = window.devicePixelRatio || 1;
    const rect = this.getBoundingClientRect();
    const w = Math.max(100, rect.width || window.innerWidth);
    const h = Math.max(100, rect.height || window.innerHeight);
    this._canvas.width = Math.floor(w * dpr);
    this._canvas.height = Math.floor(h * dpr);
    this._canvas.style.width = w + 'px';
    this._canvas.style.height = h + 'px';
    this._ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  _indexForScroll(){
    // Map the document scroll progress to frames (global progress)
    const doc = document.documentElement;
    const body = document.body;
    const scrollingElement = document.scrollingElement || doc;
    const scrollY = scrollingElement.scrollTop || window.scrollY || window.pageYOffset || doc.scrollTop || body.scrollTop || 0;
    const documentHeight = Math.max(
      scrollingElement.scrollHeight,
      body.scrollHeight,
      doc.scrollHeight,
      body.offsetHeight,
      doc.offsetHeight,
      body.clientHeight,
      doc.clientHeight
    );
    const viewportHeight = window.innerHeight || doc.clientHeight;
    const maxScroll = documentHeight - viewportHeight;
    const progress = maxScroll <= 0 ? 0 : Math.min(1, Math.max(0, scrollY / maxScroll));
    const idx = Math.floor(progress * (this.count - 1));
    return idx;
  }

  _onScroll(){
    if(this._ticking) return;
    this._ticking = true;
    requestAnimationFrame(()=>{
      this._updateFrame();
      this._ticking = false;
    });
  }

  _animate(){
    this._updateFrame();
    this._rafId = requestAnimationFrame(this._animate);
  }

  _updateFrame(){
    const idx = this._indexForScroll();
    if(idx !== this._lastDrawn){
      this._lastDrawn = idx;
      this._showFrame(idx);
    }
  }

  _onResize(){
    this._resizeCanvas();
    if(this._lastDrawn >= 0) this._drawImage(this._images[this._lastDrawn]);
  }

  _formatIndex(i){
    return String(i+1).padStart(this.pad,'0');
  }

  _makeSrc(i){
    const name = `${this.base}${this._formatIndex(i)}${this.ext}`;
    return encodeURI(name);
  }

  _preloadInitial(n){
    const first = Math.min(this.count, n);
    for(let i=0;i<first;i++) this._loadImage(i);
    // preload rest lazily in background
    setTimeout(()=>{ this._preloadAll(); }, 600);
  }

  _preloadAll(){
    for(let i=0;i<this.count;i++){
      if(!this._images[i]) this._loadImage(i);
    }
  }

  _loadImage(i, prioritize=false){
    if(this._images[i]) return this._images[i];
    const img = new Image();
    img.decoding = 'async';
    img.onload = ()=>{
      this._loaded.add(i);
      // remove loader once first image is ready
      if(this._loaded.size === 1) this._loader.style.display = 'none';
      // draw first frame immediately if nothing drawn yet
      if(this._lastDrawn === -1 && i === 0){
        this._lastDrawn = 0;
        this._drawImage(img);
      }
      // if this index is currently desired, draw
      if(i === this._lastDrawn) this._drawImage(img);
    };
    img.onerror = ()=>{ /* ignore load errors */ };
    img.src = this._makeSrc(i);
    this._images[i] = img;
    // if prioritized, try to fetch sooner by touching src (already set)
    return img;
  }

  _showFrame(i){
    // ensure neighbors are prefetched
    if(i+1 < this.count) this._loadImage(i+1);
    if(i-1 >=0) this._loadImage(i-1);

    const img = this._images[i];
    if(img && img.complete && img.naturalWidth){
      this._drawImage(img);
    } else {
      // request load for this frame
      this._loadImage(i);
      // draw nearest loaded as fallback
      const near = this._findNearestLoaded(i);
      if(near !== -1) this._drawImage(this._images[near]);
    }
  }

  _findNearestLoaded(target){
    for(let offset=0; offset < this.count; offset++){
      const plus = target + offset;
      const minus = target - offset;
      if(plus < this.count && this._loaded.has(plus)) return plus;
      if(minus >=0 && this._loaded.has(minus)) return minus;
    }
    return -1;
  }

  _drawImage(img){
    if(!img || !img.naturalWidth) return;
    const cw = this._canvas.width / (window.devicePixelRatio||1);
    const ch = this._canvas.height / (window.devicePixelRatio||1);
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    // Usar 'cover' para que la imagen ocupe todo el canvas (posible recorte)
    const scale = Math.max(cw/iw, ch/ih);
    const w = iw * scale;
    const h = ih * scale;
    const x = (cw - w)/2;
    const y = (ch - h)/2;
    this._ctx.clearRect(0,0,cw,ch);
    this._ctx.drawImage(img, x, y, w, h);
  }
}

customElements.define('frame-player', FramePlayer);
