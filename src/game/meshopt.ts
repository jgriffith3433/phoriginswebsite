import { MeshoptCompression } from '@babylonjs/core';

/**
 * The big character and prop GLBs use EXT_meshopt_compression (tools/compress-models.mjs). Babylon decodes it
 * with meshoptimizer's decoder, by default from its CDN; ours is self-hosted next to the game
 * (public/vendor/meshopt_decoder.js, copied from node_modules/meshoptimizer), so a model never waits on a third
 * site. Loaded once, the first time a compressed model is read. Node tools such as check:leaks have no page
 * address and keep Babylon's default.
 */
const baseUri = typeof document !== 'undefined' ? document.baseURI : undefined;
if (baseUri) {
  MeshoptCompression.Configuration = {
    decoder: { url: new URL('vendor/meshopt_decoder.js', baseUri).href },
  };
}
