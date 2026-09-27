declare module 'build-info' {
  export const commit: string;
}

declare module '*.svg' {
  const url: string;
  export default url;
}
