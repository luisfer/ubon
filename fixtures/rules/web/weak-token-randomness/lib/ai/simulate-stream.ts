const sampleTokens = ['Hello', ' there', ',', ' how', ' can', ' I', ' help', '?'];

export async function* simulateStream(length: number) {
  for (let i = 0; i < length; i++) {
    const token = sampleTokens[Math.floor(Math.random() * sampleTokens.length)]; // ok: picks a word for a simulated model stream
    await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30)); // ok: delay
    yield token;
  }
}
