// the code below will get moved to the wam-extensions repo
// and could be imported from webaudiomodules.com in the future
import VideoExtension from "./extensions/VideoExtension.js";
import { CanvasRenderer } from "./extensions/videoExtensionHostSide.js";

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioCtx();

let hostKey;
let renderer;
let videoPlugins = [];

const initHost = async (audioContext) => {
  // Classic initialization of a WebAudioModule host, using the helper function provided by the WAM SDK
  const { default: initializeWamHost } =
    await import("https://www.webaudiomodules.com/sdk/2.0.0-alpha.6/src/initializeWamHost.js");
  const [, key] = await initializeWamHost(audioContext, "example");
  hostKey = key;

  await initExtensions();
};

// Init extensions. Here we only have a video extension, but in the future there could be more (eg. for MIDI controllers, or haptics, etc.)
const initExtensions = async () => {
  window.WAMExtensions = window.WAMExtensions || {};
  window.WAMExtensions.video = new VideoExtension();
};

// Load a WebAudioModule, and return an instance of the plugin.
async function loadWAM(path) {
  const initialState = {};
  const { default: WAM } = await import(path);

  if (typeof WAM !== "function" || !WAM.isWebAudioModuleConstructor) {
    throw new Error(`Path ${path} is not a WebAudioModule.`);
  }

  // instance is actually a factory for the real instance, which is created asynchronously.
  // This is because the constructor of the WAM cannot be async,
  // but we often need to do async work during initialization
  // (eg. loading presets, or in this case, setting up the video extension delegate)
  const instance = new WAM("example", audioContext);
  // mandatory even is initialState is empty
  await instance.initialize(initialState);

  return instance;
}

// Create a canvas renderer for the video extension, and returns it
async function initVideo(context) {
  let canvas = document.getElementById("wam-video");
  renderer = new CanvasRenderer(canvas);
}

async function run() {
  // 1 - init host and extensions
  await initHost(audioContext);

  // Init the video extension. It needs the audioContext because often video wams are synchronized to the audio,
  // so they need access to the currentTime and other properties of the audio context.
  // it will also create a canvas and a WebGL context that will be used to render the video frames sent by the plugins, a
  // nd that will be displayed on the page.
  await initVideo(audioContext);

  // Load the butterchurn video plugin
  // as this wam has a video extension delegate, it will register itself to the video extension during initialization, 
  // and then we will be able to get it from the video extension using the instanceId of the plugin.
  // See the file  https://github.com/boourns/burns-audio-wam/blob/main/src/plugins/video_butterchurn/src/index.tsx
  // and look in the source code for the video extension delegate to see how it works. It is located in createAudioNode() method of the plugin, 
  // This createAudioNode() method is called t during initialization of the plugin.
  //
  // ICI TU DOIS POUVOIR METTRE TON WAM VIDEO ICI, A CONDITION QU'IL AIT UNE VIDEO EXTENSION DELEGATE QUI SE CONNECTE 
  // A LA VIDEO EXTENSION DANS SA FONCTION createAudioNode() COMME DANS L'EXEMPLE DE BUTTERCHURN.
  //
  let videoPluginWAM = await loadWAM(
    "https://www.webaudiomodules.com/community/plugins/burns-audio/video_butterchurn/index.js",
  );
  /*
  let videoPluginWAM = await loadWAM(
    "../my-video-wam/index.js",
  );
  */


  // Butterchurn here is the plugin. It has an audioNode property which is the AudioNode that we can connect to the audio graph,
  // and an instanceId which is a unique identifier for this instance of the plugin (useful for the extensions,
  // to know which plugin they are controlling). It has also a createGui() method which creates a UI for the plugin,
  // but this is optional and not all plugins will have it.
  videoPluginWAM.audioNode.connect(audioContext.destination);

  // create the UI and add it to the container. Returns a div that is generally a WebComponent, but could be any HTMLElement.
  const ui = await videoPluginWAM.createGui();

  // Display the GUI of the plugin. This is optional, as not all plugins will have a UI,
  // and some plugins might want to create their own UI in a different way.
  const container = document.getElementById("instrument-container")
  container.appendChild(ui)

  // As we can have more than one video plugin, we store the plugins in an array. 
  // We will need to access them later to render the video, and to pass them to the video extension.
  videoPlugins.push(videoPluginWAM);

  // Connect all video plugins to the video extension, so that they can send the video frames to the extension, 
  // and the extension can render them on the canvas.
  // After this code is executed, extension is an array containaing the video extension delegate for each plugin, 
  // which is an object that has a connectVideo() method that the plugin can call to connect to the video extension.
  // 
  // video.getDelegate(pluginId) returns the video extension delegate for this plugin, 
  // which is an object that has a connectVideo() method that the plugin can call to connect to the video extension.
  // It works because video.setDelegate(pluginId, delegate) was called in the createAudioNode() method of the plugin, 
  // so the video extension now knows which delegate is associated to each pluginId.
  let extensions = videoPlugins.map((v) =>
    window.WAMExtensions.video.getDelegate(v.instanceId),
  );

  // The video extension might need some information from the plugins to set up the video rendering,
  // so we pass an object with some options. In this case we just pass the width and height of the video, 
  // but in the future we could pass more information, like the desired frame rate, or other properties.
  let videoOptions = {
    width: 640,
    height: 480,
    gl: renderer.gl,
  };

  // here e is the video extension delegate for each plugin, and we call the connectVideo() method to connect 
  // the plugin to the video extension. The gl property is the WebGL context that the video extension will use 
  // to render the video frames sent by the plugin. gl  will draw into the canvas that we set up in the initVideo() function, and that is displayed on the page.
  for (let e of extensions) {
    console.log(e);
    e.connectVideo(videoOptions);
  }

  // let call 60 times/s mainloop() to render the video frames sent by the plugins. 
  // The mainloop() function will call the render() method of each video extension delegate, 
  // which will render the video frames sent by the plugin on the canvas.
  window.requestAnimationFrame(mainloop);
}

// Main animation loop to render the video frames sent by the plugins. It will be called 60 times/s by requestAnimationFrame.
function mainloop() {
  // get all delegates for the video plugins, to call their render() method and render the video frames sent by the plugins.
  let extensions = videoPlugins.map((v) =>
    window.WAMExtensions.video.getDelegate(v.instanceId),
  );

  let inputs = [];
  let currentTime = audioContext.currentTime;

  for (let e of extensions) {
    // we pass the currentTime to the render() method of the video extension delegate, so that the plugin can synchronize the video 
    // with the audio if it wants to.
    inputs = e.render(inputs, currentTime);
  }

  // the canvas renderer's render method takes as input the video frames sent by the plugins, and renders them on the canvas.
  // in this example we assume that there is only one video plugin, so we just take the first input, 
  // but in the future we could have more than one video plugin,
  // inputs[0] = pixels sent by the first plugin, inputs[1] = pixels sent by the second plugin, etc.
  // the renderer will draw an image from the pixels sent by the plugin, on the canvas
  renderer.render(inputs[0]);

  // Asks the browser to call mainloop again on the next frame in 1/60th of a second. 
  // This creates a loop that will render the video frames continuously.
  window.requestAnimationFrame(mainloop);
}

document.getElementById("start").addEventListener("click", () => {
  // run is the function that initializes everything and starts the main loop to render the video frames sent by the plugins.
  run();
});
