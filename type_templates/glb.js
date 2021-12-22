import * as THREE from 'three';

import metaversefile from 'metaversefile';
const {useApp, useFrame, useCleanup, useLocalPlayer, usePhysics, useLoaders, useActivate, useAvatarInternal, useInternals, useIO} = metaversefile;

// const wearableScale = 1;

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localVector3 = new THREE.Vector3();
const localVector4 = new THREE.Vector3();
const localVector5 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localQuaternion2 = new THREE.Quaternion();
const localQuaternion3 = new THREE.Quaternion();
const localEuler = new THREE.Euler();
const localMatrix = new THREE.Matrix4();

// const z180Quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

export default e => {
  const app = useApp();
  app.appType = 'glb';
  
  const root = app;
  
  const physics = usePhysics();
  const localPlayer = useLocalPlayer();
  const Avatar = useAvatarInternal();

  const srcUrl = '${this.srcUrl}';
  const components = (
    ${this.components}
  );
  for (const {key, value} of components) {
    app.setComponent(key, value);
  }
  
  let glb = null;
  const animationMixers = [];
  const uvScrolls = [];
  const physicsIds = [];
  
  // glb state
  let animations;
  
  // wear
  let wearSpec = null;
  let modelBones = null;
  
  // aim
  let appAimAnimationMixers = null;

  // pet state
  let petSpec = null;
  let petMixer = null;
  let idleAction = null;
  let walkAction = null;
  let runAction = null;
  let rootBone = null;
  
  // sit state
  let sitSpec = null;

  // flying-mounts
  let velocity = new THREE.Vector3();
  let angularVelocity = new THREE.Vector3();
  let vehicle = null;
  let yaw = 0;
  let roll = 0;
  let pitch = 0;
  let enginePower = 0;
  let powerFactor = 0.10;
  let damping = 5;
  let rotor = null;

  
  const petComponent = app.getComponent('pet');
  const _makePetMixer = () => {
    let petMixer, idleAction;
    
    let firstMesh = null;
    glb.scene.traverse(o => {
      if (firstMesh === null && o.isMesh) {
        firstMesh = o;
      }
    });
    petMixer = new THREE.AnimationMixer(firstMesh);
    
    const idleAnimation = petComponent.idleAnimation ? animations.find(a => a.name === petComponent.idleAnimation) : null;
    if (idleAnimation) {
      idleAction = petMixer.clipAction(idleAnimation);
      idleAction.play();
    } else {
      idleAction = null;
    }
    
    return {
      petMixer,
      idleAction,
    };
  };
  
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
      glb = o;
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
          }
        });
      };
      _addAntialiasing(16);
      
      const _loadHubsComponents = () => {
        const _loadAnimations = () => {
          const animationEnabled = !!(app.getComponent('animation') ?? true);
          if (animationEnabled) {
            o.traverse(o => {
              if (o.isMesh) {
                const idleAnimation = animations.find(a => a.name === 'idle');
                let clip = idleAnimation || animations[animationMixers.length];
                if (clip) {
                  const mixer = new THREE.AnimationMixer(o);
                  
                  const action = mixer.clipAction(clip);
                  action.play();

                  animationMixers.push({
                    update(deltaSeconds) {
                      mixer.update(deltaSeconds)
                    }
                  });
                }
              }
            });
          }
        };

        _loadAnimations();

        const _loadLightmaps = () => {
          const _loadLightmap = async (parser, materialIndex) => {
            const lightmapDef = parser.json.materials[materialIndex].extensions.MOZ_lightmap;
            const [material, lightMap] = await Promise.all([
              parser.getDependency("material", materialIndex),
              parser.getDependency("texture", lightmapDef.index)
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
              
              const mesh = o; // el.getObject3D("mesh") || el.getObject3D("skinnedmesh");
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
      
      root.add(o);
      
      const _addPhysics = async () => {

        let sit = app.getComponent('sit');
        if(sit && sit.mountType === "flying") {
          const physicsId = physics.addBoxGeometry(
            new THREE.Vector3(0, 0.5, 0),
            new THREE.Quaternion(),
            new THREE.Vector3(0.6, 0.4, 1.5),
            true
          );
          physicsIds.push(physicsId);
        }
        else {
          const physicsId = physics.addGeometry(o);
          physicsIds.push(physicsId);
        }
        
      };
      if (app.getComponent('physics')) {
        _addPhysics();
      }
      o.traverse(o => {
        if (o.isMesh) {
          o.frustumCulled = false;
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });      
      
      if (petComponent) {
        const m = _makePetMixer();
        petMixer = m.petMixer;
        idleAction = m.idleAction;
      }
      
      activateCb = () => {
        if (
          app.getComponent('wear') ||
          app.getComponent('pet') ||
          app.getComponent('sit')
        ) {
          app.wear();
        }
      };
    }
  })());
  
  const _unwear = () => {
    if (wearSpec) {
      wearSpec = null;
      modelBones = null;
    }
    if (petSpec) {
      petSpec = null;
      petMixer.stopAllAction();
      walkAction = null;
      runAction = null;
      rootBone = null;
      
      const m = _makePetMixer();
      petMixer = m.petMixer;
      idleAction = m.idleAction;
    }
    if (sitSpec) {
      const sitAction = localPlayer.getAction('sit');
      if (sitAction) {
        localPlayer.removeAction('sit');
        localPlayer.avatar.app.visible = true;
        physics.setCharacterControllerPosition(localPlayer.characterController, app.position);
        sitSpec = null;
      }
    }
  };
  app.addEventListener('wearupdate', e => {
    if (e.wear) {
      const {animations} = glb;
      
      wearSpec = app.getComponent('wear');
      // console.log('activate component', app, wear);
      if (wearSpec) {
        // const {app, wearSpec} = e.data;
        // console.log('got wear spec', [wearSpec.skinnedMesh, app.glb]);
        if (wearSpec.skinnedMesh && glb) {
          let skinnedMesh = null;
          glb.scene.traverse(o => {

            if (skinnedMesh === null && o.isSkinnedMesh && o.name === wearSpec.skinnedMesh) {
              skinnedMesh = o;
            }
          });
          if (skinnedMesh && localPlayer.avatar) {
          
            app.position.set(0, 0, 0);
            app.quaternion.identity(); //.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
            app.scale.set(1, 1, 1)//.multiplyScalar(wearableScale);
            app.updateMatrix();
            app.matrixWorld.copy(app.matrix);
            
            // this adds pseudo-VRM onto our GLB assuming a mixamo rig
            // used for the glb wearable skinning feature
            const _mixamoRigToFakeVRMHack = () => {
              const {nodes} = glb.parser.json;
              const boneNodeMapping = {
                hips: 'J_Bip_C_Hips',
                leftUpperLeg: 'J_Bip_L_UpperLeg',
                rightUpperLeg: 'J_Bip_R_UpperLeg',
                leftLowerLeg: 'J_Bip_L_LowerLeg',
                rightLowerLeg: 'J_Bip_R_LowerLeg',
                leftFoot: 'J_Bip_L_Foot',
                rightFoot: 'J_Bip_R_Foot',
                spine: 'J_Bip_C_Spine',
                chest: 'J_Bip_C_Chest',
                neck: 'J_Bip_C_Neck',
                head: 'J_Bip_C_Head',
                leftShoulder: 'J_Bip_L_Shoulder',
                rightShoulder: 'J_Bip_R_Shoulder',
                leftUpperArm: 'J_Bip_L_UpperArm',
                rightUpperArm: 'J_Bip_R_UpperArm',
                leftLowerArm: 'J_Bip_L_LowerArm',
                rightLowerArm: 'J_Bip_R_LowerArm',
                leftHand: 'J_Bip_L_Hand',
                rightHand: 'J_Bip_R_Hand',
                leftToes: 'J_Bip_L_ToeBase',
                rightToes: 'J_Bip_R_ToeBase',
                leftEye: 'J_Adj_L_FaceEye',
                rightEye: 'J_Adj_R_FaceEye',
                leftThumbProximal: 'J_Bip_L_Thumb1',
                leftThumbIntermediate: 'J_Bip_L_Thumb2',
                leftThumbDistal: 'J_Bip_L_Thumb3',
                leftIndexProximal: 'J_Bip_L_Index1',
                leftIndexIntermediate: 'J_Bip_L_Index2',
                leftIndexDistal: 'J_Bip_L_Index3',
                leftMiddleProximal: 'J_Bip_L_Middle1',
                leftMiddleIntermediate: 'J_Bip_L_Middle2',
                leftMiddleDistal: 'J_Bip_L_Middle3',
                leftRingProximal: 'J_Bip_L_Ring1',
                leftRingIntermediate: 'J_Bip_L_Ring2',
                leftRingDistal: 'J_Bip_L_Ring3',
                leftLittleProximal: 'J_Bip_L_Little1',
                leftLittleIntermediate: 'J_Bip_L_Little2',
                leftLittleDistal: 'J_Bip_L_Little3',
                rightThumbProximal: 'J_Bip_R_Thumb1',
                rightThumbIntermediate: 'J_Bip_R_Thumb2',
                rightThumbDistal: 'J_Bip_R_Thumb3',
                rightIndexProximal: 'J_Bip_R_Index1',
                rightIndexIntermediate: 'J_Bip_R_Index2',
                rightIndexDistal: 'J_Bip_R_Index3',
                rightMiddleProximal: 'J_Bip_R_Middle3',
                rightMiddleIntermediate: 'J_Bip_R_Middle2',
                rightMiddleDistal: 'J_Bip_R_Middle1',
                rightRingProximal: 'J_Bip_R_Ring1',
                rightRingIntermediate: 'J_Bip_R_Ring2',
                rightRingDistal: 'J_Bip_R_Ring3',
                rightLittleProximal: 'J_Bip_R_Little1',
                rightLittleIntermediate: 'J_Bip_R_Little2',
                rightLittleDistal: 'J_Bip_R_Little3',
                upperChest: 'J_Bip_C_UpperChest',
              };
              const humanBones = [];
              for (const k in boneNodeMapping) {
                const boneName = boneNodeMapping[k];
                const boneNodeIndex = nodes.findIndex(node => node.name === boneName);
                if (boneNodeIndex !== -1) {
                  const boneSpec = {
                    bone: k,
                    node: boneNodeIndex,
                    // useDefaultValues: true, // needed?
                  };
                  humanBones.push(boneSpec);
                } else {
                  console.log('failed to find bone', boneNodeMapping, k, nodes, boneNodeIndex);
                }
              }
              if (!glb.parser.json.extensions) {
                glb.parser.json.extensions = {};
              }
              glb.parser.json.extensions.VRM = {
                humanoid: {
                  humanBones,
                },
              };
            };
            _mixamoRigToFakeVRMHack();
            const bindSpec = Avatar.bindAvatar(glb);

            // skeleton = bindSpec.skeleton;
            modelBones = bindSpec.modelBones;
          }
        }
        
        // app.wear();
      }
      
      petSpec = app.getComponent('pet');
      if (petSpec) {
        const walkAnimation = (petSpec.walkAnimation && petSpec.walkAnimation !== petSpec.idleAnimation) ? animations.find(a => a.name === petSpec.walkAnimation) : null;
        if (walkAnimation) {
          walkAction = petMixer.clipAction(walkAnimation);
          walkAction.play();
        }
        const runAnimation = (petSpec.runAnimation && petSpec.runAnimation !== petSpec.idleAnimation) ? animations.find(a => a.name === petSpec.runAnimation) : null;
        if (runAnimation) {
          runAction = petMixer.clipAction(runAnimation);
          runAction.play();
        }
      }

      sitSpec = app.getComponent('sit');
      if (sitSpec) {
        let rideMesh = null;
        glb.scene.traverse(o => {
          if (rideMesh === null && o.isSkinnedMesh) {
            rideMesh = o;
          }
        });

        const {instanceId} = app;
        const localPlayer = useLocalPlayer();

        const rideBone = sitSpec.sitBone ? rideMesh.skeleton.bones.find(bone => bone.name === sitSpec.sitBone) : null;
        const sitAction = {
          type: 'sit',
          time: 0,
          animation: sitSpec.subtype,
          controllingId: instanceId,
          controllingBone: rideBone,
        };
        localPlayer.setControlAction(sitAction);
      }
    } else {
      _unwear();
    }
  });
  
  const smoothVelocity = new THREE.Vector3();
  const lastLookQuaternion = new THREE.Quaternion();
  const _getAppDistance = () => {
    const localPlayer = useLocalPlayer();
    const position = localVector.copy(localPlayer.position);
    position.y = 0;
    const distance = app.position.distanceTo(position);
    return distance;
  };
  const minDistance = 1;
  const _isFar = distance => (distance - minDistance) > 0.01;
  useFrame(({timestamp, timeDiff}) => {
    // components
    const _updateAnimation = () => {
      const petComponent = app.getComponent('pet');
      if (petComponent) {
        if (rootBone) {
          rootBone.quaternion.copy(rootBone.originalQuaternion);
          rootBone.updateMatrixWorld();
        }
        if (petMixer) { // animated pet
          if (petSpec) { // activated pet
            const speed = 0.0014;

            const distance = _getAppDistance();
            const moveDelta = localVector;
            moveDelta.setScalar(0);
            if (_isFar(distance)) { // handle rounding errors
              // console.log('distance', distance, minDistance);
              const localPlayer = useLocalPlayer();
              const position = localPlayer.position.clone();
              position.y = 0;
              const direction = position.clone()
                .sub(app.position)
                .normalize();
              const maxMoveDistance = distance - minDistance;
              const moveDistance = Math.min(speed * timeDiff, maxMoveDistance);
              moveDelta.copy(direction)
                .multiplyScalar(moveDistance);
              app.position.add(moveDelta);
              app.quaternion.slerp(localQuaternion.setFromUnitVectors(localVector2.set(0, 0, 1), direction), 0.1);
              app.updateMatrixWorld();
            } else {
              /* // console.log('check', head === drop, component.attractedTo === 'fruit', typeof component.eatSpeed === 'number');
              if (head === drop && component.attractedTo === 'fruit' && typeof component.eatSpeed === 'number') {
                drop.scale.subScalar(1/component.eatSpeed*timeDiff);
                // console.log('new scale', drop.scale.toArray());
                if (drop.scale.x <= 0 || drop.scale.y <= 0 || drop.scale.z <= 0) {
                  dropManager.removeDrop(drop);
                }
              } */
            }
            smoothVelocity.lerp(moveDelta, 0.3);
            
            const walkSpeed = 0.01;
            const runSpeed = 0.03;
            const currentSpeed = smoothVelocity.length();
            if (walkAction) {
              walkAction.weight = Math.min(currentSpeed / walkSpeed, 1);
            }
            if (runAction) {
              runAction.weight = Math.min(Math.max((currentSpeed - walkSpeed) / (runSpeed - walkSpeed), 0), 1);
            }
            if (idleAction) {
              if (walkAction || runAction) {
                idleAction.weight = 1 - Math.min(currentSpeed / walkSpeed, 1);
              } else {
                idleAction.weight = 1;
              }
            }
          } else { // unactivated pet
            if (idleAction) {
              idleAction.weight = 1;
            }
          }
          const deltaSeconds = timeDiff / 1000;
          petMixer.update(deltaSeconds);
          petMixer.getRoot().updateMatrixWorld();
        }
      } else {
        const deltaSeconds = timeDiff / 1000;
        for (const mixer of animationMixers) {
          mixer.update(deltaSeconds);
          app.updateMatrixWorld();
        }
        if (appAimAnimationMixers) {
          for (const mixer of appAimAnimationMixers) {
            mixer.update(deltaSeconds);
            app.updateMatrixWorld();
          }
        }
      }
    };
    _updateAnimation();
    
    const _updateLook = () => {
      const lookComponent = app.getComponent('look');
      if (lookComponent && glb) {
        let skinnedMesh = null;
        glb.scene.traverse(o => {
          if (skinnedMesh === null && o.isSkinnedMesh) {
            skinnedMesh = o;
          }
        });
        if (skinnedMesh) {
          const bone = skinnedMesh.skeleton.bones.find(bone => bone.name === lookComponent.rootBone);
          if (bone) {
            rootBone = bone;
            if (!bone.originalQuaternion) {
              bone.originalQuaternion = bone.quaternion.clone();
            }
            if (!bone.originalWorldScale) {
              bone.originalWorldScale = bone.getWorldScale(new THREE.Vector3());
            }
            
            if (!bone.quaternion.equals(lastLookQuaternion)) {
              const localPlayer = useLocalPlayer();
              const {position, quaternion} = localPlayer;
              localQuaternion2.setFromRotationMatrix(
                localMatrix.lookAt(
                  position,
                  bone.getWorldPosition(localVector),
                  localVector2.set(0, 1, 0)
                    // .applyQuaternion(bone.getWorldQuaternion(localQuaternion))
                )
              ).premultiply(localQuaternion.copy(app.quaternion).invert());
              localEuler.setFromQuaternion(localQuaternion2, 'YXZ');
              localEuler.y = Math.min(Math.max(localEuler.y, -Math.PI*0.5), Math.PI*0.5);
              localQuaternion2.setFromEuler(localEuler)
                .premultiply(app.quaternion);
              
              bone.matrixWorld.decompose(localVector, localQuaternion, localVector2);
              localQuaternion.copy(localQuaternion2)
                .multiply(localQuaternion3.copy(bone.originalQuaternion).invert())
                .normalize();
              bone.matrixWorld.compose(localVector, localQuaternion, bone.originalWorldScale);
              bone.matrix.copy(bone.matrixWorld)
                .premultiply(localMatrix.copy(bone.parent.matrixWorld).invert())
                .decompose(bone.position, bone.quaternion, bone.scale);
              bone.updateMatrixWorld();
              lastLookQuaternion.copy(bone.quaternion);
            }
          }
        }
      }
    };
    _updateLook();
    
    const _copyBoneAttachment = spec => {
      const {boneAttachment = 'hips', position, quaternion, scale} = spec;
      const boneName = Avatar.modelBoneRenames[boneAttachment];
      const bone = localPlayer.avatar.foundModelBones[boneName];
      if (bone) {
        bone.matrixWorld
          .decompose(app.position, app.quaternion, app.scale);
        if (Array.isArray(position)) {
          app.position.add(localVector.fromArray(position).applyQuaternion(app.quaternion));
        }
        if (Array.isArray(quaternion)) {
          app.quaternion.multiply(localQuaternion.fromArray(quaternion));
        }
        if (Array.isArray(scale)) {
          app.scale.multiply(localVector.fromArray(scale));
        }
        app.updateMatrixWorld();
      } else {
        console.warn('invalid bone attachment', {app, boneAttachment});
      }
    };
    const _updateWear = () => {
      if (wearSpec && localPlayer.avatar) {
        const {instanceId} = app;
        const localPlayer = useLocalPlayer();

        const appAimAction = Array.from(localPlayer.getActionsState())
          .find(action => action.type === 'aim' && action.instanceId === instanceId);

        // animations
        {
          {
            const appAnimation = appAimAction?.appAnimation ? animations.find(a => a.name === appAimAction.appAnimation) : null;
            if (appAnimation && !appAimAnimationMixers) {
              const clip = animations.find(a => a.name === appAimAction.appAnimation);
              if (clip) {
                appAimAnimationMixers = [];
                glb.scene.traverse(o => {
                  if (o.isMesh) {
                    const mixer = new THREE.AnimationMixer(o);
                    
                    const action = mixer.clipAction(clip);
                    action.setLoop(0, 0);
                    action.play();

                    const appAimAnimationMixer = {
                      update(deltaSeconds) {
                        mixer.update(deltaSeconds);
                      },
                      destroy() {
                        action.stop();
                      },
                    };
                    appAimAnimationMixers.push(appAimAnimationMixer);
                  }
                });
              }
            } else if (appAimAnimationMixers && !appAnimation) {
              for (const appAimAnimationMixer of appAimAnimationMixers) {
                appAimAnimationMixer.destroy();
              }
              appAimAnimationMixers = null;
            }
          }
        }
        // bone bindings
        {
          const appUseAction = Array.from(localPlayer.getActionsState())
            .find(action => action.type === 'use' && action.instanceId === instanceId);
          if (appUseAction?.boneAttachment && wearSpec.boneAttachment) {
            _copyBoneAttachment(appUseAction);
          } else {
            const appAimAction = Array.from(localPlayer.getActionsState())
              .find(action => action.type === 'aim' && action.instanceId === instanceId);
            if (appAimAction?.boneAttachment && wearSpec.boneAttachment) {
              _copyBoneAttachment(appAimAction);
            } else {
              if (modelBones) {
                Avatar.applyModelBoneOutputs(modelBones, localPlayer.avatar.modelBoneOutputs, localPlayer.avatar.getTopEnabled(), localPlayer.avatar.getBottomEnabled(), localPlayer.avatar.getHandEnabled(0), localPlayer.avatar.getHandEnabled(1));
                modelBones.Root.updateMatrixWorld();
              } else if (wearSpec.boneAttachment) {
                _copyBoneAttachment(wearSpec);
              }
            }
          }
        }
      }
    };
    _updateWear();

    const _updateRide = () => {
      if (sitSpec && localPlayer.avatar) {
        const {instanceId} = app;
        const localPlayer = useLocalPlayer();

        if(sitSpec.mountType) {
          if(sitSpec.mountType === "flying") {
            const ioManager = useIO();
            vehicle = app.physicsObjects[0];
            localPlayer.avatar.app.visible = false;
            physics.enablePhysicsObject(vehicle);
            let quat = new THREE.Quaternion(vehicle.quaternion.x, vehicle.quaternion.y, vehicle.quaternion.z, vehicle.quaternion.w);
            let right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
            let globalUp = new THREE.Vector3(0, 1, 0);
            let up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
            let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);

            let propSpec = app.getComponent("propeller");
            if(propSpec) {
              app.traverse(o => {
                // Find propeller obj
                if(o.name === propSpec.name) { rotor = o; }
               });
            }

            /*if(enginePower < 1) {
              enginePower += 0.4 * timeDiff/1000;
            }
            else {
              enginePower = 1;
            }*/
            enginePower = 1;

            // IO
            if(ioManager.keys.shift) {
              velocity.x += up.x * powerFactor * enginePower;
              velocity.y += up.y * powerFactor * enginePower;
              velocity.z += up.z * powerFactor * enginePower;
            }
            if (ioManager.keys.backward) {
              velocity.x -= up.x * powerFactor * enginePower;
              velocity.y -= up.y * powerFactor * enginePower;
              velocity.z -= up.z * powerFactor * enginePower;
            }
            if(ioManager.keys.yawLeft) {
              angularVelocity.x += up.x * powerFactor/2 * enginePower;
              angularVelocity.y += up.y * powerFactor/2 * enginePower
              angularVelocity.z += up.z * powerFactor/2 * enginePower;
            }
            if (ioManager.keys.yawRight) {
              angularVelocity.x -= up.x * powerFactor/2 * enginePower;
              angularVelocity.y -= up.y * powerFactor/2 * enginePower;
              angularVelocity.z -= up.z * powerFactor/2 * enginePower;
            }
            if(ioManager.keys.up) {
              angularVelocity.x += right.x * powerFactor/2 * enginePower;
              angularVelocity.y += right.y * powerFactor/2 * enginePower;
              angularVelocity.z += right.z * powerFactor/2 * enginePower;
            }
            if (ioManager.keys.down) {
              angularVelocity.x -= right.x * powerFactor/2 * enginePower;
              angularVelocity.y -= right.y * powerFactor/2 * enginePower;
              angularVelocity.z -= right.z * powerFactor/2 * enginePower;
            }
            if(ioManager.keys.left) {
              angularVelocity.x -= forward.x * powerFactor/2 * enginePower;
              angularVelocity.y -= forward.y * powerFactor/2 * enginePower;
              angularVelocity.z -= forward.z * powerFactor/2 * enginePower;
            }
            if (ioManager.keys.right) {
              angularVelocity.x += forward.x * powerFactor/2 * enginePower;
              angularVelocity.y += forward.y * powerFactor/2 * enginePower;
              angularVelocity.z += forward.z * powerFactor/2 * enginePower;
            }
            let gravity = new THREE.Vector3(0, -9.81, 0);
            let gravityCompensation = new THREE.Vector3(-gravity.x, -gravity.y, -gravity.z).length();
            gravityCompensation *= timeDiff/1000;
            gravityCompensation *= 0.98;
            let dot = globalUp.dot(up);
            gravityCompensation *= Math.sqrt(THREE.MathUtils.clamp(dot, 0, 1));

            let vertDamping = new THREE.Vector3(0, velocity.y, 0).multiplyScalar(-0.01);
            let vertStab = up.clone();
            vertStab.multiplyScalar(gravityCompensation);
            vertStab.add(vertDamping);
            vertStab.multiplyScalar(enginePower);

            // Fake gravity
            localVector.copy(new THREE.Vector3(0,-9.81, 0)).multiplyScalar(timeDiff/1000);
            velocity.add(localVector);

            velocity.add(vertStab);

            // Positional damping
            velocity.x *= THREE.MathUtils.lerp(1, 0.995, enginePower);
            velocity.z *= THREE.MathUtils.lerp(1, 0.995, enginePower);

            //Stabilization
            let rotStabVelocity = new THREE.Quaternion().setFromUnitVectors(up, globalUp);
            rotStabVelocity.x *= 0.3;
            rotStabVelocity.y *= 0.3;
            rotStabVelocity.z *= 0.3;
            rotStabVelocity.w *= 0.3;
            let rotStabEuler = new THREE.Euler().setFromQuaternion(rotStabVelocity);
            
            angularVelocity.x += rotStabEuler.x * enginePower / damping;
            angularVelocity.y += rotStabEuler.y * enginePower/ damping;
            angularVelocity.z += rotStabEuler.z * enginePower/ damping;

            angularVelocity.x *= 0.97;
            angularVelocity.y *= 0.97;
            angularVelocity.z *= 0.97;

            //Applying velocities
            physics.setVelocity(vehicle, velocity, false);
            physics.setAngularVelocity(vehicle, angularVelocity, false);

            //Applying physics transform to app
            vehicle.updateMatrixWorld();
            app.position.copy(vehicle.position);
            app.quaternion.copy(vehicle.quaternion);
            app.updateMatrixWorld();

            if (rotor) { rotor.rotateZ(enginePower * 10); }
          }
        }
        else {
          // Will be physics based later
          const localPlayer = useLocalPlayer();
          let vel = localPlayer.characterPhysics.velocity;
          app.position.add(localVector.copy(vel).multiplyScalar(timeDiff/1000));
          if (vel.lengthSq() > 0) {
            app.quaternion
              .setFromUnitVectors(
                localVector4.set(0, 0, -1),
                localVector5.set(vel.x, 0, vel.z).normalize()
              )
              .premultiply(localQuaternion2.setFromAxisAngle(localVector3.set(0, 1, 0), Math.PI));
          }
          app.updateMatrixWorld();
          physics.setCharacterControllerPosition(localPlayer.characterController, app.position);
        }
      }
    };
    _updateRide();
    
    // standards
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
  
  return root;
};