import { NextResponse } from 'next/server';
import { scenario } from '@/data';

export function GET() {
  return NextResponse.json(scenario, { headers: { 'Cache-Control': 'no-store' } });
}
