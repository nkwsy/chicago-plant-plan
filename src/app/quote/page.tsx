'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { PlanPlant } from '@/types/plan';

export default function QuotePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh] text-muted">Loading...</div>}>
      <QuoteForm />
    </Suspense>
  );
}

function QuoteForm() {
  const searchParams = useSearchParams();
  const planId = searchParams.get('plan') || '';
  const [plan, setPlan] = useState<any | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (planId) {
      fetch(`/api/plans?id=${planId}`)
        .then(r => r.json())
        .then(data => setPlan(data))
        .catch(() => {});
    }
  }, [planId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !planId) return;

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, email, name, phone, notes }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Failed to submit. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold mb-2">Quote Requested!</h2>
        <p className="text-muted mb-6">
          We&apos;ll compile pricing from local nurseries and email you at <strong>{email}</strong> within 2-3 business days.
        </p>
        <Link href={`/plan/${planId}`} className="text-primary hover:underline">
          ← Back to your plan
        </Link>
      </div>
    );
  }

  const uniquePlants = plan ? getUniquePlants(plan.plants || []) : [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Request a Plant Quote</h1>
      <p className="text-muted mb-6">
        We&apos;ll reach out to Chicagoland nurseries to get pricing for your plant list and handle the logistics.
      </p>

      {plan && (
        <div className="bg-surface-alt rounded-lg p-4 mb-6 border border-stone-200">
          <h3 className="font-medium mb-2">Plants in your plan: {plan.title}</h3>
          <div className="text-sm text-muted space-y-1 max-h-48 overflow-y-auto">
            {uniquePlants.map(({ plant, count }) => (
              <div key={plant.plantSlug} className="flex justify-between">
                <span>{plant.commonName} <span className="italic">({plant.scientificName})</span></span>
                <span className="font-medium">x{count}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-stone-200 text-sm font-medium">
            Total: {uniquePlants.reduce((sum, p) => sum + p.count, 0)} plants across {uniquePlants.length} species
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Email *</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 border border-stone-200 rounded-lg text-sm outline-none focus:border-primary bg-surface"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2.5 border border-stone-200 rounded-lg text-sm outline-none focus:border-primary bg-surface"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Phone (optional)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-4 py-2.5 border border-stone-200 rounded-lg text-sm outline-none focus:border-primary bg-surface"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-4 py-2.5 border border-stone-200 rounded-lg text-sm outline-none focus:border-primary bg-surface resize-none"
            placeholder="Preferred plant sizes, delivery preferences, budget range..."
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !email || !planId}
          className="w-full bg-primary text-white py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Request Quote'}
        </button>

        <p className="text-xs text-muted text-center">
          We charge a small logistics fee on top of nursery pricing. You&apos;ll see the full breakdown before committing.
        </p>
      </form>
    </div>
  );
}

function getUniquePlants(plants: PlanPlant[]): { plant: PlanPlant; count: number }[] {
  const map = new Map<string, { plant: PlanPlant; count: number }>();
  plants.forEach(p => {
    const existing = map.get(p.plantSlug);
    if (existing) existing.count += p.quantity;
    else map.set(p.plantSlug, { plant: p, count: p.quantity });
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
