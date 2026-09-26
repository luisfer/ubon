// A config list shared by client and server code; only the server reads clientSecret.
export const PROGRAMS = [
  {
    name: 'Framer',
    oauth: {
      clientId: process.env.FRAMER_CLIENT_ID as string,
      clientSecret: process.env.FRAMER_CLIENT_SECRET as string, // ok: nested in a shared config object
    },
  },
];
