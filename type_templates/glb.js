import * as THREE from 'three';

import metaversefile from 'metaversefile';
const {useApp, useFrame, useCleanup, useLocalPlayer, usePhysics, useLoaders, useActivate, useAvatarInternal, useInternals,useCameraManager, useScene} = metaversefile;

// const wearableScale = 1;

/* const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localQuaternion2 = new THREE.Quaternion();
const localQuaternion3 = new THREE.Quaternion();
const localEuler = new THREE.Euler();
const localMatrix = new THREE.Matrix4(); */

// const z180Quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

export default e => {
  const app = useApp();

  const physics = usePhysics();
  const localPlayer = useLocalPlayer();
  const cameraManager = useCameraManager();

  let scene = useScene();

  const srcUrl = ${this.srcUrl};
  for (const {key, value} of components) {
    app.setComponent(key, value);
  }

  app.glb = null;
  app.mixer = null;
  const uvScrolls = [];
  const physicsIds = [];
  app.physicsIds = physicsIds;

  // glb state
  let animations;

  // sit state
  let sitSpec = null;

  let activateCb = null;
  e.waitUntil((async () => {
    let o;
    try {
      o = await new Promise((accept, reject) => {
        const {gltfLoader} = useLoaders();
        gltfLoader.load(srcUrl, accept, function onprogress() {}, reject);
      });
    } catch(err) {
      console.warn(err);
    }
    // console.log('got o', o);
    if (o) {
      app.glb = o;
      const {parser} = o;
      animations = o.animations;
      // console.log('got animations', animations);
      o = o.scene;

      const _addAntialiasing = aaLevel => {
        o.traverse(o => {
          if (o.isMesh) {
            ['alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'envMap', 'lightMap', 'map', 'metalnessMap', 'normalMap', 'roughnessMap'].forEach(mapType => {
              if (o.material[mapType]) {
                o.material[mapType].anisotropy = aaLevel;
              }
            });
            if (o.material.transmission !== undefined) {
              o.material.transmission = 0;
              o.material.opacity = 0.25;
            }
          }
        });
      };
      _addAntialiasing(16);

      const _loadHubsComponents = () => {
        const _loadAnimations = () => {
          const animationEnabled = !!(app.getComponent('animation') ?? true);

          if (animationEnabled && animations.length > 0){

            app.mixer = new THREE.AnimationMixer(o);    // create the animation mixer with the root of the glb file

            const userIdle = app.getComponent('idleAnimation');
            const idleString = typeof userIdle === 'string' ? userIdle : 'idle';

            const idleAnimation = animations.find(a => a.name === idleString);
            const clips = idleAnimation ? [idleAnimation] : animations;
            for (const clip of clips) {
              const action = app.mixer.clipAction(clip);
              action.play();
            }

          }
        };
        if (!app.hasComponent('pet')) {
          _loadAnimations();
        }

        const _loadLightmaps = () => {
          const _loadLightmap = async (parser, materialIndex) => {
            const lightmapDef = parser.json.materials[materialIndex].extensions.MOZ_lightmap;
            const [material, lightMap] = await Promise.all([
              parser.getDependency('material', materialIndex),
              parser.getDependency('texture', lightmapDef.index)
            ]);
            material.lightMap = lightMap;
            material.lightMapIntensity = lightmapDef.intensity !== undefined ? lightmapDef.intensity : 1;
            material.needsUpdate = true;
            return lightMap;
          };
          if (parser.json.materials) {
            for (let i = 0; i < parser.json.materials.length; i++) {
              const materialNode = parser.json.materials[i];

              if (!materialNode.extensions) continue;

              if (materialNode.extensions.MOZ_lightmap) {
                _loadLightmap(parser, i);
              }
            }
          }
        };
        _loadLightmaps();

        const _loadUvScroll = o => {
          const textureToData = new Map();
          const registeredTextures = [];
          o.traverse(o => {
            if (o.isMesh && o?.userData?.gltfExtensions?.MOZ_hubs_components?.['uv-scroll']) {
              const uvScrollSpec = o.userData.gltfExtensions.MOZ_hubs_components['uv-scroll'];
              const {increment, speed} = uvScrollSpec;

              const mesh = o; // this.el.getObject3D("mesh") || this.el.getObject3D("skinnedmesh");
              const {material} = mesh;
              if (material) {
                const spec = {
                  data: {
                    increment,
                    speed,
                  },
                };

                // We store mesh here instead of the material directly because we end up swapping out the material in injectCustomShaderChunks.
                // We need material in the first place because of MobileStandardMaterial
                const instance = { component: spec, mesh };

                spec.instance = instance;
                spec.map = material.map || material.emissiveMap;

                if (spec.map && !textureToData.has(spec.map)) {
                  textureToData.set(spec.map, {
                    offset: new THREE.Vector2(),
                    instances: [instance]
                  });
                  registeredTextures.push(spec.map);
                } else if (!spec.map) {
                  console.warn("Ignoring uv-scroll added to mesh with no scrollable texture.");
                } else {
                  console.warn(
                    "Multiple uv-scroll instances added to objects sharing a texture, only the speed/increment from the first one will have any effect"
                  );
                  textureToData.get(spec.map).instances.push(instance);
                }
              }
              let lastTimestamp = Date.now();
              const update = now => {
                const dt = now - lastTimestamp;
                for (let i = 0; i < registeredTextures.length; i++) {
                  const map = registeredTextures[i];
                  const { offset, instances } = textureToData.get(map);
                  const { component } = instances[0];

                  offset.addScaledVector(component.data.speed, dt / 1000);

                  offset.x = offset.x % 1.0;
                  offset.y = offset.y % 1.0;

                  const increment = component.data.increment;
                  map.offset.x = increment.x ? offset.x - (offset.x % increment.x) : offset.x;
                  map.offset.y = increment.y ? offset.y - (offset.y % increment.y) : offset.y;
                }
                lastTimestamp = now;
              };
              uvScrolls.push({
                update,
              });
            }
          });
        };
        _loadUvScroll(o);
      };
      _loadHubsComponents();

      app.add(o);
      o.updateMatrixWorld();

      const _addPhysics = async physicsComponent => {

        const _addPhysicsId = id => {
          if (id !== null) {
            physicsIds.push(id);
          } else {
            console.warn('glb unknown physics component', physicsComponent);
          }
        };

        switch (physicsComponent.type) {
          case 'triangleMesh': {
            let worldPos = new THREE.Vector3();
            o.getWorldPosition(worldPos);
            if(cameraManager.scene2D) {
              switch (cameraManager.scene2D.perspective) {
                case 'side-scroll': {
                  if(worldPos.z === 0) {
                    _addPhysicsId(physics.addGeometry2D(o, 0));
                    // console.log("2D-Geom", "perspective:", cameraManager.scene2D.perspective);
                  }
                  else {
                    _addPhysicsId(physics.addGeometry(o));
                    // console.log("3D-Geom", "perspective:", cameraManager.scene2D.perspective);
                  }
                }
                case 'isometric': {
                  _addPhysicsId(physics.addGeometry(o));
                  // console.log("3D-Geom", "perspective:", cameraManager.scene2D.perspective);
                }
                default: {
                  // console.log("invalid perspective:", cameraManager.scene2D.perspective);
                  _addPhysicsId(physics.addGeometry(o));
                  break;
                }
              }
            }
            else {
              _addPhysicsId(physics.addGeometry(o));
            }
            _addPhysicsId(physics.addGeometry(o));
            break;
          }
          case 'convexMesh': {
            _addPhysicsId(physics.addConvexGeometry(o));
            break;
          }
          case 'omiCollider': {
            const _addCollider = async node => {
              const info = parser.associations.get(node);

              if (!info) return;

              const nodeIndex = info.nodes;
              const nodeDef = parser.json.nodes[nodeIndex];

              if (!nodeDef || !nodeDef.extensions) return;

              const colliderDef = nodeDef.extensions.OMI_collider;

              const position = new THREE.Vector3();
              const rotation = new THREE.Quaternion();
              const scale = new THREE.Vector3();

              node.matrixWorld.decompose(position, rotation, scale);

              const shortestScaleAxis = scale.toArray().sort()[0];

              let physicsId;

              const _getColliderMesh = async colliderDef => {
                const { mesh=null } = colliderDef;

                if (typeof mesh === 'number') {
                  const loadedMesh = await parser.loadMesh(mesh);

                  node.add(loadedMesh);
                  loadedMesh.visible = false;
                  loadedMesh.updateMatrixWorld();

                  return loadedMesh;
                } else {
                  return null;
                }
              }

              switch(colliderDef.type) {

                case 'box': {
                  const { extents=[1, 1, 1] } = colliderDef;

                  scale.setX(extents[0] * scale.x);
                  scale.setY(extents[1] * scale.y);
                  scale.setZ(extents[2] * scale.z);

                  _addPhysicsId(physics.addBoxGeometry(position, rotation, scale, false));

                  break;
                }

                case 'sphere': {
                  let { radius=1 } = colliderDef;

                  radius *= shortestScaleAxis;
                  _addPhysicsId(physics.addCapsuleGeometry(position, rotation, radius, 0, null, false));

                  break;
                }

                case 'capsule': {
                  let { radius=1, height=1 } = colliderDef;

                  radius *= shortestScaleAxis;
                  height *= scale.y;

                  const halfHeight = (height - (radius * 2)) / 2;

                  rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(90));
                  _addPhysicsId(physics.addCapsuleGeometry(position, rotation, radius, halfHeight, null, false));

                  break;
                }

                case 'hull': {
                  const mesh = await _getColliderMesh(colliderDef);

                  if (mesh) _addPhysicsId(physics.addConvexGeometry(mesh));

                  break;
                }

                case 'mesh': {
                  const mesh = await _getColliderMesh(colliderDef);

                  if (mesh) _addPhysicsId(physics.addGeometry(mesh));

                  break;
                }

                case 'compound': {
                  // physicsId = null;
                  break;
                }

                default: {
                  // physicsId = null;
                }

              }

              if (physicsId) {
                physicsId.name = node.name + '_PhysMesh';
                _addPhysicsId(physicsId);
              }
            };

            const _addOmiColliders = async node => {
              await _addCollider(node);

              const hasChildren = Array.isArray(node.children) && node.children.length > 0;

              if (hasChildren)
                for (const childNode of node.children) await _addOmiColliders(childNode);
            };

            await _addOmiColliders(o);

            break;
          }
          default: {
            break;
          }
        }

      };

      let physicsComponent = app.getComponent('physics');

      if (physicsComponent) {
        if (physicsComponent === true) {
          const { extensionsUsed=[] } = parser.json;
          const isUsingOmiColliders = extensionsUsed.includes('OMI_collider')

          if (isUsingOmiColliders) {
            physicsComponent = { type: 'omiCollider' };
          } else {
            physicsComponent = { type: 'triangleMesh' };
          }
        }
        _addPhysics(physicsComponent);
      }

      o.traverse(o => {
        if (o.isMesh) {
          //console.log(o);
          // if(o.name === "body" || o.name === "rims") {
          //   const textureLoader = new THREE.TextureLoader();
          //   o.material = new THREE.MeshPhysicalMaterial({color: 0x000000});
          //   let envMapTexture = textureLoader.load('https://i.ibb.co/svQWWxz/full-spherical-seamless-hdri-panorama-360-degrees-angle-view-no-traffic-asphalt-road-among-fields-wi.jpg');
          //   envMapTexture.mapping = THREE.EquirectangularReflectionMapping;
				  //   envMapTexture.encoding = THREE.sRGBEncoding;

          //   o.material.envMap = envMapTexture;

          //   o.material.roughness = 0;
          //   o.material.clearcoat = 1;
          //   o.material.reflectivity = 1;
          //   o.material.metalness = 0;
          //   o.material.envMapIntensity = 5;
          //   o.material.needsUpdate = true

          //   console.log(o, envMapTexture);
          // }
          o.frustumCulled = false;
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      activateCb = () => {
        if (
          app.getComponent('sit')
        ) {
          app.wear();
        }
      };
    }
  })());

  const _unwear = () => {
    if (sitSpec) {
      const sitAction = localPlayer.getAction('sit');
      if (sitAction) {
        localPlayer.removeAction('sit');
      }
    }
  };
  app.addEventListener('wearupdate', e => {
    if (e.wear) {
      if (app.glb) {
        // const {animations} = app.glb;

        sitSpec = app.getComponent('sit');
        if (sitSpec) {
          let rideMesh = null;
          app.glb.scene.traverse(o => {
            if (rideMesh === null && o.isSkinnedMesh) {
              rideMesh = o;
            }
          });

          const {instanceId} = app;
          const localPlayer = useLocalPlayer();

          const sitAction = {
            type: 'sit',
            time: 0,
            animation: sitSpec.subtype,
            controllingId: instanceId
          };
          localPlayer.setControlAction(sitAction);
        }
      }
    } else {
      _unwear();
    }
  });

  useFrame(({timestamp, timeDiff}) => {
    const _updateAnimation = () => {
      const deltaSeconds = timeDiff / 1000;
      if (app.mixer){
        app.mixer.update(deltaSeconds);
        app.updateMatrixWorld();
      }
    };
    _updateAnimation();

    const _updateUvScroll = () => {
      for (const uvScroll of uvScrolls) {
        uvScroll.update(timestamp);
      }
    };
    _updateUvScroll();
  });

  useActivate(() => {
    activateCb && activateCb();
  });

  useCleanup(() => {
    for (const physicsId of physicsIds) {
      physics.removeGeometry(physicsId);
    }
    _unwear();
  });

  app.stop = () => {
    if (app.mixer){
      app.mixer.stopAllAction();
      app.mixer = null;
    }
  };

  return app;
};
export const contentId = ${this.contentId};
export const name = ${this.name};
export const description = ${this.description};
export const type = 'glb';
export const components = ${this.components};
