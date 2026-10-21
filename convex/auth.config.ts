import { AuthConfig } from 'convex/server';

export default {
  providers: [
    {
      domain: 'https://cute-quagga-3337.clerk.accounts.dev',
      applicationID: 'convex',
    },
  ],
} satisfies AuthConfig;
