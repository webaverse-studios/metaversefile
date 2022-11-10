import * as THREE from 'three';
import metaversefile from 'metaversefile';
const {useApp, useCameraManager, useCamera, useCleanup, useScene2DManager, useSpriteMixer, useLocalPlayer, useFrame, usePhysics, useActivate} = metaversefile;


export default e => {
  const app = useApp();
  const cameraManager = useCameraManager();
  const camera = useCamera();
  const scene2DManager = useScene2DManager();
  const spriteMixer = useSpriteMixer();
  const localPlayer = useLocalPlayer();
  const physics = usePhysics();

  let actionSprite = null;

  //let hpMesh = new HealthMesh();

  // actions
  let idleAction = null;
  let walkAction = null;
  let attackAction = null;
  let hurtAction = null;

  let lastAttackTime = 0;
  let attackDelay = 1500;

  let actions = null;

  app.name = 'spriteAvatar';

  let clock = new THREE.Clock();

  let speed = 0;

  let targetSpec = null;
  let died = false;
  let attacking = false;

  let pivotOffset = new THREE.Vector3();

  let velocity = new THREE.Vector3();

  let lastTargetTime = 0;

  let target = new THREE.Vector3(30, 0, 30);
  let randomDelay = 3000;

  const srcUrl = ${this.srcUrl};
  const mode = app.getComponent('mode') ?? 'attached';
  if (mode === 'attached') {
    (async () => {
      const res = await fetch(srcUrl);
      const j = await res.json();
      if (j) {
        const u = j.spriteUrl;
        let o = await new Promise((accept, reject) => {
        let textureLoader = new THREE.TextureLoader();
        textureLoader.load(u, accept, function onprogress() {}, reject);
        });

        actionSprite = spriteMixer.ActionSprite(o, j.rows, j.cols);

        //Default animations

        // walk_down
        // walk_left
        // walk_right
        // walk_up

        // TODO: add option to mirror/flip horizontal sprites

        actions = {
            walk_down: spriteMixer.Action(actionSprite, j.walk_down.tiles[0], j.walk_down.tiles[1], j.walk_down.duration),
            walk_left: spriteMixer.Action(actionSprite, j.walk_left.tiles[0], j.walk_left.tiles[1], j.walk_left.duration),
            walk_right: spriteMixer.Action(actionSprite, j.walk_right.tiles[0], j.walk_right.tiles[1], j.walk_right.duration),
            walk_up: spriteMixer.Action(actionSprite, j.walk_up.tiles[0], j.walk_up.tiles[1], j.walk_up.duration),
            currentAction: null,
        };

        actionSprite.updateMatrixWorld();

        app.add(actionSprite);
        app.updateMatrixWorld();

        let offset = new THREE.Vector3(0, 0, 0); //1.25, 0.75, 0
        let avatarScale = new THREE.Vector3(0.5, 1, 1);
        physics.addBoxGeometry(app.position, new THREE.Quaternion(), new THREE.Vector3(0.25,1,0.25), false);
      }
    })();

    const _updateAnimation = () => {
          // const velocity = localPlayer.characterPhysics.velocity.clone();
          // let moveDir;

          // if(velocity.length() > 0) {
          //   moveDir = _getMoveDirection(velocity);
          // }

          let avatarVelocity = velocity.clone();

          let velX = Math.round(parseFloat(avatarVelocity.x).toFixed(2));
          let velZ = Math.round(parseFloat(avatarVelocity.z).toFixed(2));

          if (velX > 0) {
            if (actionSprite.currentAction !== actions.walk_right) {
              actions.walk_right.playLoop();
            }
          } else if (velX < 0) {
            if (actionSprite.currentAction !== actions.walk_left) {
              actions.walk_left.playLoop();
            }
          } else if (velZ > 0) {
            if (actionSprite.currentAction !== actions.walk_down) {
              actions.walk_down.playLoop();
            }
          } else if (velZ < 0) {
            if (actionSprite.currentAction !== actions.walk_up) {
              actions.walk_up.playLoop();
            }
          } else {
            if(actionSprite.currentAction) {
              actionSprite.currentAction.stop();
              actionSprite.currentAction = null;
            }
          }
      }

    const _randomTarget = (timestamp) => {

        if(((timestamp - lastTargetTime) > randomDelay)) {
            let randX = 30 + (Math.random() * 15);
            let randZ = 30 + (Math.random() * 15);
            target.set(randX, app.position.y, randZ);
            lastTargetTime = timestamp;
            randomDelay = 2000 + (Math.random() * 1000);
        }
        return target;
    }

    const _updatePhysics = (timestamp) => {
        if(localPlayer) {
            let targetPos = null;
            if(!targetSpec) {
                targetPos = _randomTarget(timestamp);
            }
            else {
                targetPos = targetSpec.position;
            }
            //let target = _randomTarget(timestamp);
            let dist = app.position.distanceTo(targetPos);
            let dir = new THREE.Vector3();
            dir.subVectors(targetPos, app.position);
            dir.normalize();

            //velocity = dir.clone();

            //console.log(dist);
            if(dist > 1) {
                velocity = dir.clone();
                app.position.add(dir.multiplyScalar(0.035));
            }
            else {
                velocity.set(0,0,0);
            }
        }
    }

    useFrame(({timestamp, timeDiff}) => {
        //console.log("update frame")
        if (actionSprite) {
          var delta = clock.getDelta();

          //console.log("got actionsprite");

          if (actions) {
            //console.log("got actions");
            _updatePhysics(timestamp);
            _updateAnimation();

          // actionSprite.mirrored = _isRight();
          // if (actionSprite.mirrored) {
          //   pivotOffset.set(0, 0, 0); //1.2, 0, 0
          //   actionSprite.position.copy(pivotOffset.multiplyScalar(2));
          //   app.updateMatrixWorld();
          // } else {
          //   pivotOffset.set(0, 0, 0);
          //   actionSprite.position.copy(pivotOffset);
          //   app.updateMatrixWorld();
          // }
        }

          spriteMixer.update(delta);
          app.updateMatrixWorld();
          //hpMesh.update();
        }
      });

      useActivate(() => {
        targetSpec = localPlayer;
      });

    useCleanup(() => {
      //scene2DManager.reset();
    });
  }

  return app;
};
export const contentId = ${this.contentId};
export const name = ${this.name};
export const description = ${this.description};
export const type = 'spriteavatar';
export const components = ${this.components};
