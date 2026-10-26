import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../image-embedding.js', import.meta.url), 'utf8');
function embeddingApi(load) {
  const context = { window: {}, tf: {}, mobilenet: { load }, console: { log() {}, error() {} } };
  vm.runInNewContext(source, context);
  return context.window.ImageEmbedding;
}

test('create preload returns the cached model promise', async () => {
  let loads = 0;
  const model = {};
  const api = embeddingApi(async () => { loads++; return model; });
  const first = api.preloadModel();
  assert.equal(typeof first.then, 'function');
  assert.equal(await first, model);
  assert.equal(await api.preloadModel(), model);
  assert.equal(loads, 1);
});

test('preload failures reach the caller and allow retry', async () => {
  let loads = 0;
  const api = embeddingApi(async () => { if (++loads === 1) throw Error('Model offline'); return {}; });
  await assert.rejects(api.preloadModel(), /Model offline/);
  await api.preloadModel();
  assert.equal(loads, 2);
});

test('image inference returns the 1024-value vector and disposes its tensor', async () => {
  let disposed = false;
  const image = { tagName: 'IMG', complete: true };
  const api = embeddingApi(async () => ({ infer(input, embedding) {
    assert.equal(input, image); assert.equal(embedding, true);
    return { data: async () => new Float32Array(1024).fill(0.5), dispose() { disposed = true; } };
  } }));
  const vector = await api.getImageEmbedding(image);
  assert.equal(vector.length, 1024); assert.equal(vector[0], 0.5); assert.equal(disposed, true);
});

for (const failure of ['readback', 'dimensions']) test(`tensor is disposed after ${failure} failure`, async () => {
  let disposed = false;
  const api = embeddingApi(async () => ({ infer: () => ({
    data: async () => { if (failure === 'readback') throw Error('Readback failed'); return new Float32Array(3); },
    dispose() { disposed = true; }
  }) }));
  await assert.rejects(api.getImageEmbedding({}), failure === 'readback' ? /Readback/ : /dimension mismatch/);
  assert.equal(disposed, true);
});
