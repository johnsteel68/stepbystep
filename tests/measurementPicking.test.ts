import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Scene } from 'three';
import { createMeasurementPicker } from '../viewer/annotations/measurementPicking.ts';

const canvas = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 } as DOMRect),
};

function setup() {
  const scene = new Scene();
  const camera = new OrthographicCamera(-100, 100, 100, -100, 1, 1000);
  camera.position.z = 100;
  camera.updateMatrixWorld(true);
  const group = new Group();
  group.userData.measureHoles = [{ id: 'centre', point: [0, 0, 0], label: 'Centre du trou' }];
  scene.add(group);
  return { scene, group, pick: createMeasurementPicker(canvas, camera, scene) };
}

test('picking returns a hole centre and follows transforms without rebuilding the picker', () => {
  const { group, pick } = setup();
  assert.equal(pick({ clientX: 100, clientY: 100 })?.kind, 'hole');
  group.position.x = 50;
  assert.equal(pick({ clientX: 100, clientY: 100 }), null);
  assert.equal(pick({ clientX: 150, clientY: 100 })?.a.x, 50);
});

test('hidden parents exclude their hole references', () => {
  const { group, pick } = setup();
  const parent = new Group();
  group.parent!.add(parent);
  parent.add(group);
  parent.visible = false;
  assert.equal(pick({ clientX: 100, clientY: 100 }), null);
});

test('a hole behind the metal cannot be picked through its front surface', () => {
  const { scene, pick } = setup();
  const geometry = new BoxGeometry(100, 100, 2);
  const material = new MeshBasicMaterial();
  const sheet = new Mesh(geometry, material);
  sheet.position.z = 10;
  sheet.userData.measureSurface = true;
  scene.add(sheet);
  try {
    assert.equal(pick({ clientX: 100, clientY: 100 }), null);
  } finally {
    geometry.dispose();
    material.dispose();
  }
});

test('an empty viewport has no selectable feature', () => {
  const { scene } = setup();
  const camera = new OrthographicCamera();
  const emptyCanvas = { getBoundingClientRect: () => ({ width: 0, height: 0 } as DOMRect) };
  assert.equal(createMeasurementPicker(emptyCanvas, camera, scene)({ clientX: 0, clientY: 0 }), null);
});

test('bend references snap as segments, follow transforms and respect occlusion', () => {
  const { scene, group, pick } = setup();
  group.userData.measureHoles = [];
  group.userData.measureBends = [{ id: 'bend-inner', a: [-50, 0, 0], b: [50, 0, 0], label: 'Pli 1 · intérieur' }];
  assert.equal(pick({ clientX: 110, clientY: 100 })?.kind, 'bend');
  group.position.y = 40;
  assert.equal(pick({ clientX: 110, clientY: 100 }), null);
  assert.equal(pick({ clientX: 110, clientY: 60 })?.label, 'Pli 1 · intérieur');
  const geometry = new BoxGeometry(150, 150, 2);
  const material = new MeshBasicMaterial();
  const sheet = new Mesh(geometry, material);
  sheet.position.z = 10;
  sheet.userData.measureSurface = true;
  scene.add(sheet);
  try {
    assert.notEqual(pick({ clientX: 110, clientY: 60 })?.kind, 'bend');
  } finally { geometry.dispose(); material.dispose(); }
  sheet.visible = false;
  group.visible = false;
  assert.equal(pick({ clientX: 110, clientY: 60 }), null);
});
