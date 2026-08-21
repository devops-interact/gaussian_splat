/**
 * Eager Babylon.js side effects — must load before GLB import so Vite does not
 * emit circular lazy chunks (ScanView ↔ pbrMaterialLoadingAdapter).
 */
import '@babylonjs/core/Materials/PBR/pbrMaterial';
import '@babylonjs/core/Materials/PBR/openpbrMaterial';
import '@babylonjs/loaders/glTF/glTFFileLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/pbrMaterialLoadingAdapter';
import '@babylonjs/loaders/glTF/2.0/openpbrMaterialLoadingAdapter';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_draco_mesh_compression';
