import packageMetadata from '../../package.json';

export const APP_VERSION = packageMetadata.version;
export const APP_DISPLAY_VERSION = `v_${APP_VERSION.split('.').slice(0, 2).join('.')}`;
export const APP_WINDOW_TITLE = `NatsumeNote ${APP_DISPLAY_VERSION}`;
