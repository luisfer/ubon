import { tool } from 'ai';
import { z } from 'zod';

const CITIES = ['Lisbon', 'Madrid', 'Paris', 'Berlin'] as const;

export const weather = tool({
  description: 'Current temperature in one of the cities we support',
  inputSchema: z.object({ city: z.enum(CITIES) }),
  execute: async ({ city }) => {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?current=temperature_2m&city=${encodeURIComponent(city)}`);
    return res.json();
  },
});
