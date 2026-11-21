#!/usr/bin/env python3
"""Fit local XP profiles to stable footage endpoints under explicit gauge assumptions."""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy.optimize import LinearConstraint, minimize

EVIDENCE = Path(__file__).resolve().parents[1] / 'docs/reference-evidence'


def observations():
    ordinary = json.loads((EVIDENCE / '148-experience-slope.json').read_text())['samples']
    deep = json.loads((EVIDENCE / '149-deep-xp-crosscheck.json').read_text())['samples']
    ordinary_rows = [(3, row['credit'], row['greenEndExclusive']) for row in ordinary]
    # Stable Lv4 anchors and the 357s payout balance from the video audit.
    ordinary_rows += [
        (4, 400, 136), (4, 440, 138), (4, 520, 142), (4, 800, 154),
        (4, 1080, 168), (4, 1480, 187), (4, 2080, 215), (5, 4456, 152),
    ]
    deep_rows = [(6, row['cumulativeXP'], row['greenEndExclusive']) for row in deep]
    deep_rows.append((7, 11198, 203))  # Stable 410s payout balance.
    return ordinary_rows, deep_rows


def fit(rows, width, origin, initial):
    start = rows[0][0]
    recorded_levels, credits, endpoints = np.array(rows).T
    slots = np.arange(len(initial))
    levels_above_start = recorded_levels[:, None] - start
    threshold = (slots == levels_above_start + 1).astype(float)
    balance = ((slots == 0).astype(float) -
               ((slots > 0) & (slots <= levels_above_start)).astype(float))

    def endpoint_errors(parameters):
        left = balance @ parameters + credits
        return origin + width * left / (threshold @ parameters) - endpoints

    fit_result = minimize(
        lambda parameters: np.sum(endpoint_errors(parameters) ** 2),
        initial,
        method='SLSQP',
        bounds=[(1, None)] * len(initial),
        constraints=[
            LinearConstraint(balance, -credits, np.inf),
            LinearConstraint(balance - threshold, -np.inf, -credits - 2),
        ],
        options={'ftol': 1e-11, 'maxiter': 2500},
    )
    if not fit_result.success:
        raise ValueError(f'Unable to fit the XP profile: {fit_result.message}')
    parameters = np.rint(fit_result.x).astype(int)
    residual = balance @ parameters + credits
    if np.any(residual < 0) or np.any(residual >= threshold @ parameters):
        raise ValueError('Rounding the thresholds changed an observed level')
    errors = endpoint_errors(parameters)
    return {
        'initialXP': int(parameters[0]),
        'thresholds': dict(zip(range(start, start + len(initial) - 1),
                               map(int, parameters[1:]))),
        'maxEndpointErrorPx': float(np.max(np.abs(errors))),
        'predictions': [
            {'level': level, 'credits': credit, 'observedEndpoint': observed,
             'predictedEndpoint': round(observed + float(error), 3)}
            for (level, credit, observed), error in zip(rows, errors)
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--width', type=float, default=164)
    parser.add_argument('--origin', type=float, default=132)
    args = parser.parse_args()
    if not np.isfinite(args.width) or args.width <= 0 or not np.isfinite(args.origin):
        parser.error('width must be positive and both gauge parameters must be finite')
    ordinary, deep = observations()
    report = {
        'gauge': {'width': args.width, 'origin': args.origin},
        'mirkwood': fit(ordinary, args.width, args.origin, [1640, 2000, 3400, 6000]),
        'mirkwooddeep': fit(deep, args.width, args.origin, [1100, 7700, 11000]),
    }
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
