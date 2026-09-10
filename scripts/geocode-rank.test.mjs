import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPlaceResult, NAME_PREFIX, POI_CLASSES, POI_TYPES } from '../lib/geocode-rank.js';

// Caso real: "Andarax" es a la vez una calle y un bar/restaurante en Almería.
const ANDARAX = [
  { name: 'Andarax', class: 'highway', type: 'residential', addresstype: 'road', importance: 0.2, lat: '36.8543', lon: '-2.3564' },
  { name: 'Andarax', class: 'amenity', type: 'restaurant', addresstype: 'amenity', importance: 0.15, lat: '36.8419', lon: '-2.4545', address: { house_number: '63', road: 'Calle Hermanos Pinzón', city: 'Almería' } },
  { name: 'Laujar de Andarax', class: 'boundary', type: 'administrative', addresstype: 'village', importance: 0.45, lat: '36.9939', lon: '-2.8898' }
];

test('pickPlaceResult prefiere el POI al camino homónimo', () => {
  const { best, nameHit } = pickPlaceResult(ANDARAX, 'Andarax', { lat: 36.838, lon: -2.46 });
  assert.equal(best.class, 'amenity');
  assert.equal(best.type, 'restaurant');
  assert.equal(nameHit, true);
});

test('pickPlaceResult: nombre exacto + cercanía desempatan a favor del sitio buscado', () => {
  // Sin centro: el restaurante sigue ganando por ser POI + nombre exacto.
  assert.equal(pickPlaceResult(ANDARAX, 'Andarax').best.type, 'restaurant');
  // Con centro lejano (Madrid) el pueblo homónimo NO debe colarse por delante.
  assert.equal(pickPlaceResult(ANDARAX, 'Andarax', { lat: 40.4, lon: -3.7 }).best.type, 'restaurant');
});

test('pickPlaceResult: una dirección con número gana a la calle sin número', () => {
  const list = [
    { name: 'Calle Mayor', class: 'highway', type: 'residential', addresstype: 'road', importance: 0.3, lat: '37.0', lon: '-3.0' },
    { name: 'Calle Mayor 10', class: 'place', type: 'house', addresstype: 'place', importance: 0.1, lat: '37.001', lon: '-3.001', address: { house_number: '10', road: 'Calle Mayor' } }
  ];
  assert.equal(pickPlaceResult(list, 'Calle Mayor 10').best.address.house_number, '10');
});

test('nameHit es false cuando el mejor resultado no lleva el nombre buscado', () => {
  const list = [{ name: 'Bar de la Barandilla', class: 'amenity', type: 'bar', addresstype: 'amenity', importance: 0.1, lat: '36.99', lon: '-2.89' }];
  const { best, nameHit } = pickPlaceResult(list, 'Bar Andarax', { lat: 36.84, lon: -2.46 });
  assert.equal(best.name, 'Bar de la Barandilla');
  assert.equal(nameHit, false); // -> el servidor reintenta sin el prefijo "Bar "
});

test('un hotel se detecta por `type` aunque `class`/`category` venga vacío', () => {
  // Forma real de Nominatim/Geoapify para hoteles: {class:undefined, type:"hotel"}.
  const list = [
    { name: 'Avenida del Mediterráneo', class: 'highway', type: 'primary', addresstype: 'road', importance: 0.35, lat: '36.83', lon: '-2.45' },
    { name: 'ah! Avenida Hotel', class: undefined, type: 'hotel', addresstype: 'building', importance: 0.1, lat: '36.8498', lon: '-2.4469', address: { house_number: '281', road: 'Avenida del Mediterráneo' } }
  ];
  const { best } = pickPlaceResult(list, 'Sercotel Avenida Almería', { lat: 36.84, lon: -2.46 });
  assert.equal(best.type, 'hotel');
  assert.ok(POI_TYPES.has('hotel') && POI_TYPES.has('museum'));
});

test('NAME_PREFIX quita el genérico inicial pero respeta el resto', () => {
  assert.equal('Bar Andarax'.replace(NAME_PREFIX, '').trim(), 'Andarax');
  assert.equal('Restaurante El Faro'.replace(NAME_PREFIX, '').trim(), 'El Faro');
  assert.equal('Museo de Almería'.replace(NAME_PREFIX, '').trim(), 'de Almería');
  assert.equal('Andarax'.replace(NAME_PREFIX, '').trim(), 'Andarax'); // sin prefijo, intacto
  assert.ok(POI_CLASSES.has('amenity') && POI_CLASSES.has('tourism'));
});
