import type { JSX } from 'react';
import './RiskGauge.css';

interface RiskGaugeProps {
  score: number; // 0 to 1
  level?: 'low' | 'medium' | 'high' | string | null | undefined;
  title?: string;
  subtitle?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  hideBox?: boolean;
  hideScore?: boolean;
  hideTitle?: boolean;
}

type LevelMeta = { text: string; bg: string; border: string };

const LEVEL_LABEL: Record<string, string> = {
  low: 'Low Risk',
  medium: 'Elevated Risk',
  high: 'High Risk',
};

const DEFAULT_META: LevelMeta = { text: '#0E5700', bg: '#C3F0CD', border: '#bbecd0' };

const LEVEL_COLOR: Record<string, LevelMeta> = {
  low: DEFAULT_META,
  medium: { text: '#F38516', bg: '#FFFEC0', border: '#fce4b6' },
  high: { text: '#D72424', bg: '#FFE3E0', border: '#fbd5d0' },
};

interface GaugeState {
  pct: number;
  needleAngle: number;
  levelMeta: LevelMeta;
  levelText: string;
}

function resolveGauge(score: number, level: RiskGaugeProps['level']): GaugeState {
  const clamped = Math.min(1, Math.max(0, score));
  const pct = Math.round(clamped * 100);
  const needleAngle = clamped * 160 - 80; // -80deg (left) to +80deg (right)
  const activeLevel = (
    level ?? (clamped > 0.65 ? 'high' : clamped > 0.35 ? 'medium' : 'low')
  ).toLowerCase();
  const levelMeta = LEVEL_COLOR[activeLevel] ?? DEFAULT_META;
  const levelText = LEVEL_LABEL[activeLevel] ?? activeLevel.toUpperCase();
  return { pct, needleAngle, levelMeta, levelText };
}

function GaugeHead({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string | undefined;
}): JSX.Element {
  return (
    <div className="rg-gauge-card__head">
      <span className="rg-gauge-card__title">{title}</span>
      {subtitle && <span className="rg-gauge-card__sub">{subtitle}</span>}
    </div>
  );
}

function GaugeDial({ needleAngle, pct }: { needleAngle: number; pct: number }): JSX.Element {
  return (
    <svg
      viewBox="0 0 180 100"
      className="rg-gauge-svg"
      role="img"
      aria-label={`Risk score ${pct} percent`}
    >
      <defs>
        <linearGradient id="rgSmoothGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="50%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#EF4444" />
        </linearGradient>
      </defs>

      {/* Smooth Background Track */}
      <path
        d="M 25 85 A 65 65 0 0 1 155 85"
        fill="none"
        stroke="#F1F5F9"
        strokeWidth="12"
        strokeLinecap="round"
      />

      {/* Smooth Gradient Value Track */}
      <path
        d="M 25 85 A 65 65 0 0 1 155 85"
        fill="none"
        stroke="url(#rgSmoothGrad)"
        strokeWidth="12"
        strokeLinecap="round"
      />

      {/* Pivot Base & Tapered Needle */}
      <g
        transform={`rotate(${needleAngle}, 90, 85)`}
        style={{ transition: 'transform 0.5s ease-out' }}
      >
        <path d="M 85.5 85 L 89 28 C 89.5 27 90.5 27 91 28 L 94.5 85 Z" fill="#2D3748" />
        <circle cx="90" cy="85" r="6" fill="#2D3748" />
        <circle cx="90" cy="85" r="2" fill="#FFFFFF" />
      </g>
    </svg>
  );
}

function GaugeReadout({
  hideScore,
  pct,
  levelMeta,
  levelText,
}: {
  hideScore: boolean;
  pct: number;
  levelMeta: LevelMeta;
  levelText: string;
}): JSX.Element {
  return (
    <div className="rg-gauge-readout">
      {!hideScore && (
        <span className="rg-gauge-score">
          {pct}
          <small>/100</small>
        </span>
      )}
      <span
        className="rg-gauge-pill"
        style={{
          color: levelMeta.text,
          backgroundColor: levelMeta.bg,
          borderColor: levelMeta.border,
        }}
      >
        {levelText}
      </span>
    </div>
  );
}

export function RiskGauge({
  score,
  level,
  title,
  subtitle,
  className = '',
  size = 'md',
  hideBox = true,
  hideScore = false,
  hideTitle = false,
}: RiskGaugeProps): JSX.Element {
  const { pct, needleAngle, levelMeta, levelText } = resolveGauge(score, level);
  const boxClass = hideBox ? 'rg-gauge-card--nobox' : '';

  return (
    <div className={`rg-gauge-card rg-gauge-card--${size} ${boxClass} ${className}`}>
      {!hideTitle && title && <GaugeHead title={title} subtitle={subtitle} />}
      <div className="rg-gauge-visual">
        <GaugeDial needleAngle={needleAngle} pct={pct} />
        <GaugeReadout hideScore={hideScore} pct={pct} levelMeta={levelMeta} levelText={levelText} />
      </div>
    </div>
  );
}
