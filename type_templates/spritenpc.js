import metaversefile from 'metaversefile';
const {useApp, useSpriteAvatarManager, useCleanup} = metaversefile;

export default e => {
  const app = useApp();
  const spriteAvatarManager = useSpriteAvatarManager();

  const srcUrl = ${this.srcUrl};

  e.waitUntil((async () => {
    await spriteAvatarManager.addSpriteApp(app, srcUrl);
  })());

  useCleanup(() => {
    spriteAvatarManager.removeSpriteApp(app);
  });

  return app;
};
export const contentId = ${this.contentId};
export const name = ${this.name};
export const description = ${this.description};
export const type = 'spriteAvatar';
export const components = ${this.components};
