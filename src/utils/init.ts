import { writeFileSync } from 'fs';
import { join } from 'path';
import { UbonScan } from '..';
import { ScanResult, ScanOptions } from '../types';

export interface InitOptions { profile?: 'auto'|'react'|'next'; interactive?: boolean }
interface ProjectAnalysis {
  detectedProfile: 'react' | 'next' | 'node';
  commonFalsePositives: string[];
  recommendedMinConfidence: number;
  suggestedDisabledRules: string[];
  baselineRecommended: boolean;
}

export async function initializeConfig(options: InitOptions) {
  console.log('🔍 Analyzing project...');
  const scanner = new UbonScan(false, true);
  const results = await scanner.diagnose({ directory: process.cwd(), profile: 'auto' } as ScanOptions);
  const analysis = analyzeProject(results);
  const config = generateOptimalConfig(analysis, options);
  const configPath = join(process.cwd(), 'ubon.config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✅ Generated ubon.config.json');
  console.log(`📊 Profile: ${analysis.detectedProfile}`);
  console.log(`🎯 Recommended min confidence: ${config.minConfidence ?? 'none'}`);
  if ((config as any).disabledRules?.length) console.log(`🚫 Disabled noisy rules: ${(config as any).disabledRules.join(', ')}`);
  if (analysis.baselineRecommended) console.log('💡 Run `ubon check --update-baseline` to suppress existing issues');
}

function analyzeProject(results: ScanResult[]): ProjectAnalysis {
  const detectedProfile: ProjectAnalysis['detectedProfile'] = 'next';
  const noisy = new Map<string, number>();
  for (const r of results) noisy.set(r.ruleId, (noisy.get(r.ruleId)||0)+1);
  const suggestedDisabledRules = Array.from(noisy.entries()).filter(([id,count]) => id==='SEC018' && count>5).map(([id])=>id);
  const recommendedMinConfidence = 0.7;
  return { detectedProfile, commonFalsePositives: [], recommendedMinConfidence, suggestedDisabledRules, baselineRecommended: results.length>20 };
}

function generateOptimalConfig(analysis: ProjectAnalysis, options: InitOptions) {
  return {
    profile: options.profile || analysis.detectedProfile,
    minConfidence: analysis.recommendedMinConfidence,
    failOn: 'error',
    disabledRules: analysis.suggestedDisabledRules
  };
}


