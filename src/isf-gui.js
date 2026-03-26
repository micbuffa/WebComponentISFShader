export class ISFGUI {
  constructor({ root, renderer, onLog } = {}) {
    this.root = root;
    this.renderer = renderer;
    this.onLog = typeof onLog === 'function' ? onLog : () => {};
  }

  log(message) {
    this.onLog(message);
  }

  clear() {
    if (this.root) {
      this.root.innerHTML = '';
    }
  }

  buildFromInputs(inputs = []) {
    this.clear();

    for (const input of inputs) {
      try {
        this.#buildInput(input);
      } catch (err) {
        this.log(`Erreur GUI pour ${input?.NAME ?? 'input inconnu'}: ${err.message}`);
      }
    }
  }

  #buildInput(input) {
    const type = input.TYPE;
    const name = input.NAME;

    if (!name || !type) {
      throw new Error('Input ISF invalide');
    }

    if (type === 'float' || type === 'long' || type === 'int') {
      this.#addNumberInput(input);
      return;
    }

    if (type === 'bool') {
      this.#addBoolInput(input);
      return;
    }

    if (type === 'color') {
      this.#addColorInput(input);
      return;
    }

    if (type === 'point2D') {
      this.#addPoint2DInput(input);
      return;
    }

    if (type === 'image') {
      this.#addImageInput(input);
      return;
    }

    this.log(`Type GUI non pris en charge: ${type} (${name})`);
  }

  #makeRow(labelText) {
    const row = document.createElement('div');
    row.className = 'row';

    const label = document.createElement('label');
    label.textContent = labelText;

    row.appendChild(label);
    return { row, label };
  }

  #addNumberInput(input) {
    const name = input.NAME;
    const type = input.TYPE;
    const min = Number(input.MIN ?? 0);
    const max = Number(input.MAX ?? 1);
    const def = Number(input.DEFAULT ?? min);
    const step = Number(input.STEP ?? (type === 'float' ? 0.01 : 1));

    const { row } = this.#makeRow(name);

    const wrap = document.createElement('div');
    wrap.className = 'range-wrap';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(def);

    const number = document.createElement('input');
    number.type = 'number';
    number.min = String(min);
    number.max = String(max);
    number.step = String(step);
    number.value = String(def);

    const sync = (rawValue) => {
      const value = Number(rawValue);
      slider.value = String(value);
      number.value = String(value);
      this.renderer.setInputValue(name, value);
    };

    slider.addEventListener('input', () => sync(slider.value));
    number.addEventListener('input', () => sync(number.value));

    sync(def);

    wrap.append(slider, number);
    row.appendChild(wrap);
    this.root.appendChild(row);
  }

  #addBoolInput(input) {
    const name = input.NAME;
    const def = Boolean(input.DEFAULT ?? false);

    const row = document.createElement('div');
    row.className = 'row-inline';

    const label = document.createElement('label');
    label.textContent = name;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = def;

    const sync = () => {
      this.renderer.setInputValue(name, checkbox.checked ? 1 : 0);
    };

    checkbox.addEventListener('change', sync);
    sync();

    row.append(label, checkbox);
    this.root.appendChild(row);
  }

  #addColorInput(input) {
    const name = input.NAME;
    const def = Array.isArray(input.DEFAULT) ? input.DEFAULT.slice(0, 4) : [1, 1, 1, 1];

    const { row } = this.#makeRow(name);

    const color = document.createElement('input');
    color.type = 'color';
    color.value = this.#rgbaToHex(def);

    const alphaWrap = document.createElement('div');
    alphaWrap.className = 'range-wrap';

    const alphaSlider = document.createElement('input');
    alphaSlider.type = 'range';
    alphaSlider.min = '0';
    alphaSlider.max = '1';
    alphaSlider.step = '0.01';
    alphaSlider.value = String(def[3] ?? 1);

    const alphaNumber = document.createElement('input');
    alphaNumber.type = 'number';
    alphaNumber.min = '0';
    alphaNumber.max = '1';
    alphaNumber.step = '0.01';
    alphaNumber.value = String(def[3] ?? 1);

    const sync = () => {
      const rgb = this.#hexToRgb01(color.value);
      const alpha = Number(alphaSlider.value);
      alphaNumber.value = String(alpha);
      this.renderer.setInputValue(name, [rgb[0], rgb[1], rgb[2], alpha]);
    };

    const syncAlpha = (v) => {
      const a = Number(v);
      alphaSlider.value = String(a);
      alphaNumber.value = String(a);
      const rgb = this.#hexToRgb01(color.value);
      this.renderer.setInputValue(name, [rgb[0], rgb[1], rgb[2], a]);
    };

    color.addEventListener('input', sync);
    alphaSlider.addEventListener('input', () => syncAlpha(alphaSlider.value));
    alphaNumber.addEventListener('input', () => syncAlpha(alphaNumber.value));

    sync();

    alphaWrap.append(alphaSlider, alphaNumber);
    row.appendChild(color);
    row.appendChild(alphaWrap);
    this.root.appendChild(row);
  }

  #addPoint2DInput(input) {
    const name = input.NAME;
    const min = Array.isArray(input.MIN) ? input.MIN : [0, 0];
    const max = Array.isArray(input.MAX) ? input.MAX : [1, 1];
    const def = Array.isArray(input.DEFAULT) ? input.DEFAULT : [0.5, 0.5];
    const step = Number(input.STEP ?? 0.01);

    const { row } = this.#makeRow(name);

    const wrap = document.createElement('div');
    wrap.className = 'point2d-wrap';

    const x = document.createElement('input');
    x.type = 'number';
    x.min = String(min[0]);
    x.max = String(max[0]);
    x.step = String(step);
    x.value = String(def[0]);

    const y = document.createElement('input');
    y.type = 'number';
    y.min = String(min[1]);
    y.max = String(max[1]);
    y.step = String(step);
    y.value = String(def[1]);

    const sync = () => {
      this.renderer.setInputValue(name, [Number(x.value), Number(y.value)]);
    };

    x.addEventListener('input', sync);
    y.addEventListener('input', sync);

    sync();

    wrap.append(x, y);
    row.appendChild(wrap);
    this.root.appendChild(row);
  }

  #addImageInput(input) {
    const name = input.NAME;

    const { row } = this.#makeRow(`${name} (image)`);

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';

    const info = document.createElement('div');
    info.className = 'meta';
    info.textContent = 'Aucune image chargée';

    file.addEventListener('change', async () => {
      const selected = file.files?.[0];
      if (!selected) return;

      try {
        await this.renderer.setImageInput(name, selected);
        info.textContent = `Chargée: ${selected.name}`;
        this.log(`Image chargée pour ${name}: ${selected.name}`);
      } catch (err) {
        info.textContent = `Erreur: ${err.message}`;
        this.log(`Erreur image ${name}: ${err.message}`);
      }
    });

    row.append(file, info);
    this.root.appendChild(row);
  }

  #rgbaToHex(rgba) {
    const r = Math.round((rgba[0] ?? 1) * 255);
    const g = Math.round((rgba[1] ?? 1) * 255);
    const b = Math.round((rgba[2] ?? 1) * 255);

    return (
      '#' +
      [r, g, b]
        .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
        .join('')
    );
  }

  #hexToRgb01(hex) {
    const s = hex.replace('#', '');
    const n = parseInt(s, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
}
