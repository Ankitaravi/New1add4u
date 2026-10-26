import {
  BadGatewayException, Body, Controller, HttpException, HttpStatus, Inject, Post, Req,
} from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AI_PROVIDER, AiProvider } from './ai.provider';

export const DISCLAIMER = 'This is general information, not a diagnosis. Please consult a doctor.';

/** Phrases that mean "stop chatting, get help now". Checked before any model call. */
const RED_FLAGS = [
  /chest (pain|pressure|tightness)/i, /can'?t breathe|difficulty breathing|shortness of breath/i,
  /unconscious|unresponsive|fainted/i, /stroke|face droop|slurred speech|one side.*(weak|numb)/i,
  /severe bleeding|vomiting blood|coughing blood/i, /suicid|kill myself|end my life/i,
  /seizure|convulsion/i, /overdose|poison/i,
];

const SYMPTOM_SYSTEM = `You are a cautious medical triage assistant for an Indian healthcare app. You do NOT diagnose.
Given symptoms, reply with ONLY a JSON object: {"urgency":"self_care"|"see_doctor"|"emergency","possibleConditions":[string],"suggestedSpecialization":string,"advice":string}.
Keep possibleConditions to at most 4 common, plausible conditions phrased as possibilities. If in doubt about urgency, choose the more urgent level. No text outside the JSON.`;

const INTERACTION_SYSTEM = `You are a clinical pharmacology assistant. Given a list of drugs, reply with ONLY a JSON object:
{"interactions":[{"drugs":[string,string],"severity":"minor"|"moderate"|"major","description":string}],"summary":string}.
Only list interactions you are confident exist. An empty list is valid. No text outside the JSON.`;

class SymptomDto {
  @IsString() @MinLength(3) @MaxLength(1000) symptoms: string;
  @IsOptional() @IsInt() @Min(0) @Max(120) age?: number;
}
class InteractionDto {
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(80, { each: true })
  drugs: string[];
}

function parseJson(text: string): any {
  const m = text.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(m ? m[0] : text);
  } catch {
    throw new BadGatewayException('AI returned an unreadable answer; please try again');
  }
}

@Controller('ai')
export class AiController {
  /** userId -> request timestamps; protects the paid API from a single user looping. */
  private hits = new Map<string, number[]>();
  constructor(@Inject(AI_PROVIDER) private ai: AiProvider) {}

  private limit(userId: string) {
    const max = Number(process.env.AI_HOURLY_LIMIT ?? 20);
    const since = Date.now() - 3600_000;
    const recent = (this.hits.get(userId) ?? []).filter((t) => t > since);
    if (recent.length >= max) throw new HttpException('AI request limit reached; try again later', HttpStatus.TOO_MANY_REQUESTS);
    recent.push(Date.now());
    this.hits.set(userId, recent);
  }

  @Post('symptom-check')
  async symptomCheck(@Req() req: any, @Body() b: SymptomDto) {
    if (RED_FLAGS.some((r) => r.test(b.symptoms))) {
      return {
        urgency: 'emergency', possibleConditions: [], suggestedSpecialization: 'Emergency Medicine',
        advice: 'These symptoms can be serious. Call 112 or go to the nearest emergency department now.',
        disclaimer: DISCLAIMER, source: 'rules',
      };
    }
    this.limit(req.user.id);
    const out = parseJson(await this.ai.complete(SYMPTOM_SYSTEM, `Age: ${b.age ?? 'unknown'}\nSymptoms: ${b.symptoms}`));
    if (!['self_care', 'see_doctor', 'emergency'].includes(out.urgency)) throw new BadGatewayException('AI returned an invalid answer');
    return {
      urgency: out.urgency,
      possibleConditions: (Array.isArray(out.possibleConditions) ? out.possibleConditions : []).slice(0, 4).map(String),
      suggestedSpecialization: String(out.suggestedSpecialization ?? 'General Medicine'),
      advice: String(out.advice ?? ''),
      disclaimer: DISCLAIMER, source: 'ai',
    };
  }

  @Post('drug-interaction')
  async drugInteraction(@Req() req: any, @Body() b: InteractionDto) {
    this.limit(req.user.id);
    const out = parseJson(await this.ai.complete(INTERACTION_SYSTEM, `Drugs: ${b.drugs.join(', ')}`));
    const interactions = (Array.isArray(out.interactions) ? out.interactions : []).filter(
      (i: any) => ['minor', 'moderate', 'major'].includes(i?.severity) && Array.isArray(i.drugs),
    );
    return { interactions, summary: String(out.summary ?? ''), disclaimer: DISCLAIMER, source: 'ai' };
  }
}
