/**
 * ClaimVerificationService — integrates with Faultline-Pro (FP) API.
 *
 * Sends text to FP POST /scan, parses the claim verification results,
 * and formats them as a spoken response suitable for TTS playback.
 *
 * Usage:
 *   const svc = new ClaimVerificationService("http://localhost:3001", "fp-key-xxx");
 *   const result = await svc.scan("The vaccine is 95% effective.");
 *   if (result) console.log(result.spoken);
 */

// Minimal inline types — no import from FP project
type ClaimStatus = 'supported' | 'contradicted' | 'mixed' | 'unverified' | 'loading' | 'skipped';
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface FpClaim {
  id: string;
  text: string;
  type: 'fact' | 'opinion' | 'interpretation';
  importance: number; // 1-5
}

interface FpVerification {
  claimId: string;
  status: ClaimStatus;
  explanation: string;
}

interface FpScanResponse {
  claims: FpClaim[];
  verifications: Record<string, FpVerification>;
  overallRisk: RiskLevel;
}

/** Aggregated claim verification counts with a TTS-ready spoken summary. */
export interface ClaimVerificationResult {
  totalClaims: number;
  factClaims: number;      // claims where type === 'fact' and importance >= 3
  verified: number;        // status === 'supported'
  contradicted: number;    // status === 'contradicted'
  unverified: number;      // status === 'unverified' | 'mixed' | 'skipped' | 'loading'
  overallRisk: RiskLevel;
  highestRiskClaim?: string; // text of highest importance contradicted or unverified fact claim
  spoken: string;            // formatted for TTS readback
}

const UNVERIFIED_STATUSES = new Set<ClaimStatus>(['unverified', 'mixed', 'skipped', 'loading']);

/** Scans text for fact claims via the Faultline-Pro API and formats results for TTS. */
export class ClaimVerificationService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  /**
   * Scan text for verifiable fact claims via the Faultline-Pro API.
   *
   * Returns null when there are no fact claims with importance >= 3
   * (caller should not interrupt for opinions or minor claims).
   * Throws on network error or non-2xx response.
   *
   * @param text - The text to scan for claims
   * @returns Verification result with spoken summary, or null if nothing to verify
   */
  async scan(text: string): Promise<ClaimVerificationResult | null> {
    const response = await fetch(`${this.baseUrl}/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({ text, provider: 'mock' }),
    });

    if (!response.ok) {
      throw new Error(`Faultline-Pro API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as FpScanResponse;

    // Filter to only fact claims with importance >= 3
    const qualifyingClaims = data.claims.filter(
      (c) => c.type === 'fact' && c.importance >= 3,
    );

    if (qualifyingClaims.length === 0) {
      return null;
    }

    let verified = 0;
    let contradicted = 0;
    let unverified = 0;

    for (const claim of qualifyingClaims) {
      const verification = data.verifications[claim.id];
      if (!verification) {
        // No verification entry — treat as unverified
        unverified++;
        continue;
      }

      if (verification.status === 'supported') {
        verified++;
      } else if (verification.status === 'contradicted') {
        contradicted++;
      } else if (UNVERIFIED_STATUSES.has(verification.status)) {
        unverified++;
      }
    }

    // highestRiskClaim: highest importance contradicted claim, or highest importance unverified if none
    const highestRiskClaim = this._pickHighestRiskClaim(qualifyingClaims, data.verifications);

    const counts = {
      factClaims: qualifyingClaims.length,
      verified,
      contradicted,
      unverified,
      overallRisk: data.overallRisk,
      highestRiskClaim,
    };

    return {
      totalClaims: data.claims.length,
      ...counts,
      spoken: this.formatSpoken(counts),
    };
  }

  /**
   * Format verification counts as a TTS-friendly spoken sentence.
   *
   * Examples:
   *   - "I found 3 claims to verify. 2 are supported. 1 is unverified. Risk level: medium."
   *   - "That claim appears to be supported. Risk level: low." (single claim)
   *   - "All 4 claims check out. Risk level: low." (all supported)
   *   - "Warning: 2 claim(s) appear to be contradicted. Risk level: high. The disputed claim is: <text>"
   *
   * @param counts - Subset of ClaimVerificationResult fields needed for formatting
   */
  formatSpoken(
    counts: Pick<
      ClaimVerificationResult,
      'factClaims' | 'verified' | 'contradicted' | 'unverified' | 'overallRisk' | 'highestRiskClaim'
    >,
  ): string {
    const { factClaims, verified, contradicted, unverified, overallRisk, highestRiskClaim } = counts;
    const riskSuffix = `Risk level: ${overallRisk}.`;

    // Single claim path
    if (factClaims === 1) {
      const parts: string[] = [];
      if (contradicted === 1) {
        parts.push(`Warning: that claim appears to be contradicted.`);
        if (highestRiskClaim) {
          parts.push(`The disputed claim is: ${highestRiskClaim}`);
        }
      } else if (verified === 1) {
        parts.push(`That claim appears to be supported.`);
      } else {
        parts.push(`That claim is unverified.`);
      }
      parts.push(riskSuffix);
      return parts.join(' ');
    }

    // Multi-claim paths
    if (contradicted > 0) {
      const parts: string[] = [
        `Warning: ${contradicted} claim(s) appear to be contradicted.`,
        riskSuffix,
      ];
      if (highestRiskClaim) {
        parts.push(`The disputed claim is: ${highestRiskClaim}`);
      }
      return parts.join(' ');
    }

    if (unverified === 0 && contradicted === 0) {
      return `All ${factClaims} claims check out. ${riskSuffix}`;
    }

    // General case
    const parts: string[] = [`I found ${factClaims} claims to verify.`];
    if (verified > 0) {
      parts.push(`${verified} are supported.`);
    }
    if (unverified > 0) {
      parts.push(`${unverified} ${unverified === 1 ? 'is' : 'are'} unverified.`);
    }
    parts.push(riskSuffix);
    return parts.join(' ');
  }

  /**
   * Pick the text of the highest-importance contradicted claim.
   * Falls back to the highest-importance unverified claim if no contradicted claims exist.
   */
  private _pickHighestRiskClaim(
    claims: FpClaim[],
    verifications: Record<string, FpVerification>,
  ): string | undefined {
    // Separate contradicted and unverified claims
    const contradicted: FpClaim[] = [];
    const unverifiedClaims: FpClaim[] = [];

    for (const claim of claims) {
      const v = verifications[claim.id];
      if (!v) {
        unverifiedClaims.push(claim);
        continue;
      }
      if (v.status === 'contradicted') {
        contradicted.push(claim);
      } else if (UNVERIFIED_STATUSES.has(v.status)) {
        unverifiedClaims.push(claim);
      }
    }

    const byImportanceDesc = (a: FpClaim, b: FpClaim) => b.importance - a.importance;

    if (contradicted.length > 0) {
      return contradicted.sort(byImportanceDesc)[0].text;
    }

    if (unverifiedClaims.length > 0) {
      return unverifiedClaims.sort(byImportanceDesc)[0].text;
    }

    return undefined;
  }
}
