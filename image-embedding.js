// =====================================================================
// image-embedding.js
// FreeUpper Visual Embeddings — v1.0.0
// =====================================================================
//
// PURPOSE
// -----------------------------------------------------------------
// Runs MobileNet entirely in the browser (no server, no API cost) to
// convert an uploaded image into a 1024-number vector that captures
// its visual content. This vector gets saved alongside the post and
// used for:
//   - "similar posts" recommendations (pgvector cosine search)
//   - (later) category auto-tagging via reference embeddings
//
// DEPENDENCIES (add these script tags before this file):
//   <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js"></script>
//   <script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js"></script>
//
// =====================================================================

(function () {
  'use strict';

  if (typeof tf === 'undefined' || typeof mobilenet === 'undefined') {
    console.error('image-embedding.js: TensorFlow.js / MobileNet not loaded. Add the CDN script tags before this file.');
    return;
  }

  let modelPromise = null;

  // ===================================================================
  // LOAD MODEL (cached — only downloads once per session)
  // ===================================================================
  function loadModel() {
    if (!modelPromise) {
      console.log('[image-embedding.js] Loading MobileNet…');
      modelPromise = mobilenet.load({ version: 2, alpha: 1.0 })
        .then(model => {
          console.log('[image-embedding.js] MobileNet ready.');
          return model;
        })
        .catch(err => {
          console.error('[image-embedding.js] Failed to load MobileNet:', err);
          modelPromise = null; // allow retry on next call
          throw err;
        });
    }
    return modelPromise;
  }

  // Call this early (e.g. when the create-post page opens) so the
  // model is already warm by the time the user picks an image —
  // avoids a multi-second delay right at upload time.
  function preloadModel() {
    loadModel().catch(() => {});
  }

  // ===================================================================
  // GET EMBEDDING FROM AN IMAGE ELEMENT
  // -------------------------------------------------------------
  // imageElement must be a loaded <img> (or HTMLCanvasElement /
  // ImageBitmap) — i.e. .complete === true and naturalWidth > 0.
  // Returns a plain JS array of 1024 floats, ready to send to Supabase.
  // ===================================================================
  async function getImageEmbedding(imageElement) {
    if (!imageElement || (imageElement.tagName === 'IMG' && !imageElement.complete)) {
      throw new Error('image-embedding.js: image element is not loaded yet.');
    }

    const model = await loadModel();

    // infer(img, true) returns the internal 1024-dim feature vector
    // (the layer before final classification) — this is the actual
    // "embedding" we want for similarity comparison, not class labels.
    const embeddingTensor = model.infer(imageElement, true);
    const array = await embeddingTensor.data();
    embeddingTensor.dispose(); // free GPU/CPU memory immediately

    return Array.from(array);
  }

  // ===================================================================
  // GET EMBEDDING FROM A FILE / BLOB (e.g. straight from <input type=file>)
  // -------------------------------------------------------------
  // Convenience wrapper — loads the file into an offscreen <img>,
  // waits for it to decode, then runs getImageEmbedding on it.
  // ===================================================================
  function getEmbeddingFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = async () => {
        try {
          const embedding = await getImageEmbedding(img);
          URL.revokeObjectURL(url);
          resolve(embedding);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image-embedding.js: failed to load image file.'));
      };

      img.src = url;
    });
  }

  // ===================================================================
  // COSINE SIMILARITY (utility — useful for client-side comparisons,
  // e.g. comparing a freshly-picked image against a small in-memory
  // set before upload, without a DB round-trip)
  // ===================================================================
  function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ===================================================================
  // PUBLIC API
  // ===================================================================
  window.ImageEmbedding = {
    preloadModel,
    loadModel,
    getImageEmbedding,
    getEmbeddingFromFile,
    cosineSimilarity
  };

  console.log('✅ image-embedding.js v1.0.0 loaded.');
})();
