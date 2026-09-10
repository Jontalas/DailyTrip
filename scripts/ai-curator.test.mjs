import test from 'node:test';
import assert from 'node:assert/strict';
import { aiConfigured, normName, aiRank, applyAiRanking, aiCuratePlaces } from '../lib/ai-curator.js';

test('aiConfigured refleja la presencia de clave', () => {
  assert.equal(aiConfigured(''), false);
  assert.equal(aiConfigured('   '), false);
  assert.equal(aiConfigured('AQ.xxx'), true);
});

test('normName normaliza acentos, mayúsculas y puntuación para casar nombres', () => {
  assert.equal(normName('Cueva de Nerja (Málaga)'), 'cueva de nerja malaga');
  assert.equal(normName('  ALCAZABA  de   Almería '), 'alcazaba de almeria');
});

test('applyAiRanking prioriza la nota de la IA y no hunde lo que no menciona', () => {
  const ranking = { [normName('Alcazaba')]: 95, [normName('Mirador X')]: 80 };
  const items = [
    { id: 'a', name: 'Catedral', interestScore: 70 },
    { id: 'b', name: 'Alcazaba', interestScore: 40 },
    { id: 'c', name: 'Mirador X', interestScore: 30 },
    { id: 'd', name: 'Plaza vieja', interestScore: 65 }
  ];
  const ordered = applyAiRanking(items, ranking).map((x) => x.id);
  // Alcazaba (95) y Mirador X (80) suben por delante; Catedral (70) y Plaza (65)
  // conservan su orden relativo por interestScore.
  assert.deepEqual(ordered, ['b', 'c', 'a', 'd']);
  // La nota de la IA queda anotada en el item para el cliente.
  assert.equal(applyAiRanking(items, ranking).find((x) => x.id === 'b').aiInterest, 95);
});

test('applyAiRanking sin ranking devuelve la lista intacta (copia)', () => {
  const items = [{ id: 'a', name: 'A', interestScore: 1 }, { id: 'b', name: 'B', interestScore: 2 }];
  const out = applyAiRanking(items, {});
  assert.deepEqual(out.map((x) => x.id), ['a', 'b']);
  assert.notEqual(out, items);
});

test('aiRank usa aiInterest del item, luego el ranking por nombre, luego interestScore', () => {
  assert.equal(aiRank({ name: 'X', aiInterest: 88, interestScore: 10 }, {}), 88);
  assert.equal(aiRank({ name: 'Faro', interestScore: 10 }, { faro: 55 }), 55);
  assert.equal(aiRank({ name: 'Sin nota', interestScore: 42 }, { otro: 9 }), 42);
});

test('aiCuratePlaces sin clave no llama a la red y devuelve vacío', async () => {
  let called = false;
  const res = await aiCuratePlaces({ kind: 'route', from: 'A', to: 'B' }, {
    key: '',
    fetch: async () => { called = true; return { ok: true, json: async () => ({}) }; }
  });
  assert.equal(called, false);
  assert.deepEqual(res, { suggestions: [], ranking: {}, reasons: {}, source: 'off' });
});

test('aiCuratePlaces parsea la respuesta de Gemini en sugerencias + ranking', async () => {
  const payload = {
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            places: [
              { name: 'Cueva de Nerja', locality: 'Nerja', category: 'nature', interest: 92, reason: 'Gran cueva.' },
              { name: 'Castillo', category: 'inventada', interest: 60, reason: '' },
              { name: '', interest: 10 },
              { name: 'Sin nota', interest: 'x' }
            ]
          })
        }]
      }
    }]
  };
  const res = await aiCuratePlaces({ kind: 'activities', area: 'Nerja' }, {
    key: 'AQ.test',
    fetch: async (url, opts) => {
      assert.ok(String(url).includes('generateContent'));
      assert.ok(JSON.parse(opts.body).generationConfig.responseMimeType === 'application/json');
      return { ok: true, json: async () => payload };
    }
  });
  assert.equal(res.source, 'gemini');
  assert.equal(res.suggestions.length, 2); // se descartan la vacía y la de nota inválida
  assert.equal(res.suggestions[1].category, 'attraction'); // categoría fuera de lista -> attraction
  assert.equal(res.ranking[normName('Cueva de Nerja')], 92);
  assert.equal(res.reasons[normName('Cueva de Nerja')], 'Gran cueva.');
});

test('aiCuratePlaces nunca lanza: un fallo de red se traduce en resultado vacío', async () => {
  const res = await aiCuratePlaces({ kind: 'route', from: 'A', to: 'B' }, {
    key: 'AQ.test',
    fetch: async () => { throw new Error('boom'); }
  });
  assert.equal(res.source, 'error');
  assert.deepEqual(res.suggestions, []);
  assert.equal(res.error, 'boom');
});

test('aiCuratePlaces propaga el mensaje de error de la API cuando responde !ok', async () => {
  const res = await aiCuratePlaces({ kind: 'route', from: 'A', to: 'B' }, {
    key: 'AQ.test',
    fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }) })
  });
  assert.equal(res.source, 'error');
  assert.match(res.error, /API key not valid/);
});
