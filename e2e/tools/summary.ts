// A Playwright reporter that writes how a part of a run went to the file E2E_SUMMARY names, for tools/run.ts: how
// many tests passed, failed and were skipped, and how long the part took.

import { writeFileSync } from 'node:fs'
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

export interface Summary {
  passed: number
  failed: number
  skipped: number
  /** Tests marked `test.fail()` that failed as expected: a known bug of p3p2's. */
  known: number
  seconds: number
  status: FullResult['status']
}

export default class SummaryReporter implements Reporter {
  private readonly counts = { passed: 0, failed: 0, skipped: 0, known: 0 }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Only a test's last try counts.
    if (result.retry < test.retries && result.status !== 'passed' && result.status !== 'skipped') return
    const outcome = test.outcome()
    if (outcome === 'skipped') this.counts.skipped++
    else if (outcome === 'unexpected') this.counts.failed++
    else if (test.expectedStatus === 'failed') this.counts.known++
    else this.counts.passed++
  }

  onEnd(result: FullResult): void {
    const file = process.env.E2E_SUMMARY
    if (!file) return
    const summary: Summary = { ...this.counts, seconds: Math.round(result.duration / 100) / 10, status: result.status }
    writeFileSync(file, JSON.stringify(summary))
  }

  printsToStdio(): boolean {
    return false
  }
}
