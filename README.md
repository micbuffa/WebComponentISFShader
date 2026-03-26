# ISF Modular Demo

Démo de web component pour charger des shaders de style ISF avec GUI générée automatiquement.

## Lancer

Servez simplement le dossier avec un serveur HTTP local, par exemple :

```bash
python -m http.server 8000
```

Puis ouvrez `http://localhost:8000`.

## Contenu

- `index.html`
- `src/isf-parser.js`
- `src/isf-gui.js`
- `src/isf-renderer.js`
- `src/isf-web-component.js`
- `shaders/*.fs`

## Fonctionnalités

- web component `<isf-shader-renderer>`
- méthode `connect(target, options?)`
  - `connect(canvas)` : sortie finale vers le canvas hôte
  - `connect(autreComposant, { inputName })` : chaînage GPU entre composants
- GUI auto-générée depuis `INPUTS`
- presets externes
- console d'erreurs
- support simple de :
  - float / int / long / bool
  - color
  - point2D
  - image
  - `TIME`, `TIMEDELTA`, `FRAMEINDEX`, `PASSINDEX`, `DATE`, `RENDERSIZE`
  - `isf_FragNormCoord`
  - `IMG_THIS_PIXEL`, `IMG_NORM_PIXEL`, `IMG_PIXEL`
  - multipass simple
  - targets persistants avec ping-pong

## Chaîner plusieurs shaders

Exemple JavaScript :

```js
rendererA.connect(rendererB);
rendererB.connect(rendererC);
rendererC.connect(canvas);
```

Shaders de démo prévus pour cette chaîne :
- `shaders/Chain_Source.fs` (générateur)
- `shaders/Chain_WaveDistort.fs` (post-process avec `inputImage`)
- `shaders/Chain_VignetteTint.fs` (post-process final avec `inputImage`)

Le composant aval lit automatiquement la texture du composant amont sur son premier `INPUT` de type `image`.
Pour cibler un input précis :

```js
rendererA.connect(rendererB, { inputName: 'inputImage' });
```

## Limites

Ce n'est pas un runtime ISF complet :
- pas d'audio FFT
- pas d'imports ISF avancés
- pas de support complet de toutes les conventions ISF
# WebComponentISFShader
