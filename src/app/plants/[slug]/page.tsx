'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SUPPLIERS } from '@/lib/suppliers';
import type { Plant } from '@/types/plant';

export default function PlantDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [plant, setPlant] = useState<Plant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/plants?slug=${slug}`)
      .then(r => r.json())
      .then(data => {
        if (data && !data.error) setPlant(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh] text-muted">Loading...</div>;
  if (!plant) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h2 className="text-xl font-bold mb-2">Plant not found</h2>
      <Link href="/plants" className="text-primary hover:underline">Browse all plants</Link>
    </div>
  );

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Link href="/plants" className="text-muted text-sm hover:text-foreground mb-4 inline-block">← Back to plant guide</Link>

      <div className="md:flex gap-8">
        {/* Image placeholder */}
        <div className="w-full md:w-64 h-48 md:h-64 rounded-xl flex-shrink-0 flex items-center justify-center mb-6 md:mb-0"
          style={{ backgroundColor: getPlantBgColor(plant.bloomColor) }}>
          <div className="w-24 h-24 rounded-full" style={{ backgroundColor: getPlantColor(plant.bloomColor) }} />
        </div>

        <div className="flex-1">
          <h1 className="text-3xl font-bold">{plant.commonName}</h1>
          <p className="text-lg text-muted italic">{plant.scientificName}</p>
          <p className="text-sm text-muted mb-4">{plant.family}</p>

          <p className="text-muted leading-relaxed mb-6">{plant.description}</p>

          <div className="flex flex-wrap gap-2 mb-6">
            <Badge color="green">{plant.plantType}</Badge>
            <Badge color="amber">{plant.effortLevel} effort</Badge>
            {plant.deerResistant && <Badge color="blue">Deer resistant</Badge>}
            {plant.wildlifeValue.map(w => (
              <Badge key={w} color="purple">
                {w === 'pollinators' ? '🐝 ' : w === 'butterflies' ? '🦋 ' : w === 'birds' ? '🐦 ' : '🐿 '}
                {w}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Details grid */}
      <div className="grid md:grid-cols-2 gap-6 mt-8">
        <DetailSection title="Growing Conditions">
          <DetailRow label="Sun" value={plant.sun.map(s => s.replace('_', ' ')).join(', ')} />
          <DetailRow label="Moisture" value={plant.moisture.join(', ')} />
          <DetailRow label="Soil" value={plant.soilTypes.join(', ')} />
          <DetailRow label="Native habitat" value={plant.nativeHabitats.join(', ')} />
        </DetailSection>

        <DetailSection title="Size & Appearance">
          <DetailRow label="Height" value={`${plant.heightMinInches}" - ${plant.heightMaxInches}"`} />
          <DetailRow label="Spread" value={`${plant.spreadMinInches}" - ${plant.spreadMaxInches}"`} />
          <DetailRow label="Bloom color" value={plant.bloomColor} />
          <DetailRow label="Bloom season" value={`${months[plant.bloomStartMonth - 1]} - ${months[plant.bloomEndMonth - 1]}`} />
        </DetailSection>

        <DetailSection title="Care Notes">
          <p className="text-sm text-muted leading-relaxed">{plant.careNotes}</p>
        </DetailSection>

        <DetailSection title="Planting Instructions">
          <p className="text-sm text-muted leading-relaxed">{plant.plantingInstructions}</p>
        </DetailSection>
      </div>

      {/* Bloom timeline */}
      <div className="mt-8">
        <h3 className="font-semibold mb-3">Bloom Calendar</h3>
        <div className="flex gap-0.5">
          {months.map((m, i) => {
            const isBloom = (i + 1) >= plant.bloomStartMonth && (i + 1) <= plant.bloomEndMonth;
            return (
              <div key={m} className="flex-1 text-center">
                <div
                  className="h-8 rounded"
                  style={{
                    backgroundColor: isBloom ? getPlantColor(plant.bloomColor) : '#f5f5f4',
                  }}
                />
                <div className="text-xs text-muted mt-1">{m}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Suppliers */}
      {plant.suppliers && plant.suppliers.length > 0 && (
        <div className="mt-8">
          <h3 className="font-semibold mb-3">Where to Buy</h3>
          <div className="space-y-2">
            {plant.suppliers.map(ps => {
              const supplier = SUPPLIERS.find(s => s.slug === ps.supplierSlug);
              if (!supplier) return null;
              return (
                <div key={ps.supplierSlug} className="flex items-center justify-between p-3 bg-surface rounded-lg border border-stone-200">
                  <div>
                    <span className="font-medium">{supplier.name}</span>
                    <span className="text-sm text-muted ml-2">{supplier.location}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {ps.availability.map(a => (
                      <span key={a} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded capitalize">{a.replace('_', ' ')}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 bg-surface rounded-lg border border-stone-200">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-stone-100 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium capitalize">{value}</span>
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  const colorClasses: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
  };
  return <span className={`text-xs px-2.5 py-1 rounded-full capitalize ${colorClasses[color] || colorClasses.green}`}>{children}</span>;
}

function getPlantColor(bloomColor: string): string {
  const colors: Record<string, string> = {
    purple: '#8b5cf6', blue: '#3b82f6', pink: '#ec4899', red: '#ef4444',
    orange: '#f97316', yellow: '#eab308', white: '#e5e7eb', green: '#22c55e',
    lavender: '#a78bfa', gold: '#ca8a04', crimson: '#dc2626', coral: '#fb923c',
    violet: '#7c3aed', magenta: '#d946ef', cream: '#fef3c7', rose: '#f43f5e',
  };
  return colors[bloomColor?.toLowerCase()] || '#9ca3af';
}
function getPlantBgColor(c: string) { return getPlantColor(c) + '20'; }
