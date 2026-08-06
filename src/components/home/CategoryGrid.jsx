// Category-led discovery for the home screen.
//
// Modelled on SpotHero's category tiles, with two deliberate departures:
//
//   1. "Monthly" is replaced by PREMIUM HOTSPOTS. ParkEasy does not sell
//      monthly bays — the subscription buys access to founder-curated free
//      spots and EV picks. A tile promising monthly parking would sell
//      something we don't have.
//
//   2. Every tile DOES something on tap. A category grid that scrolls you to
//      the same undifferentiated list is decoration; each of these applies a
//      real filter, runs a real search, or opens a real screen.
//
// Tiles are illustrated with a gradient + icon rather than photography.
// Stock photos of American parking garages would be worse than no photo at
// all, and we don't have licensed imagery for six categories.
import React from 'react';
import { Calendar, Plane, Hotel, Moon, Sun, Sparkles, Coffee, ShoppingBag, Beer, ChevronRight } from 'lucide-react';
import { space, type, color, radius, elevation, motion } from '../../theme/tokens';
import { Text, Overline, Badge } from '../ui';

export const CATEGORIES = [
  {
    id: 'events', title: 'Events & Games', blurb: 'Fleadh, Casement, Windsor, the SSE',
    Icon: Calendar, from: '#C9A7FF', to: '#8B5CF6', action: 'event',
  },
  {
    id: 'airports', title: 'Airports', blurb: 'City & International, long stay',
    Icon: Plane, from: '#7CC4FF', to: '#3B82F6', action: 'search', query: 'Belfast City Airport',
  },
  {
    id: 'hotels', title: 'Travel & Hotels', blurb: 'Park near where you’re staying',
    Icon: Hotel, from: '#54E6D8', to: '#2ED3C6', action: 'search', query: 'hotel',
  },
  {
    id: 'nights', title: 'Nights & Weekends', blurb: 'Free after hours, if you know where',
    Icon: Moon, from: '#8DA2BD', to: '#475569', action: 'filter', filter: 'free',
  },
  {
    id: 'commuting', title: 'Daily & Commuting', blurb: 'Council car parks & park-and-ride',
    Icon: Sun, from: '#FFD27A', to: '#EAB308', action: 'filter', filter: 'freenow',
  },
  // Each of these searches a PLACE, not a word. "cafe" and "brunch" return
  // nothing — there is no café in the business directory and no spot mentions
  // one — so a tile searching for them would look broken. Searching the areas
  // where Belfast actually eats and drinks returns real spots, and the blurb
  // says which area so the tile is honest about where it takes you.
  {
    id: 'brunch', title: 'Brunch & Cafés', blurb: 'Ormeau Road and around',
    Icon: Coffee, from: '#F5B98A', to: '#D97706', action: 'search', query: 'Ormeau',
  },
  {
    id: 'shopping', title: 'Shopping', blurb: 'Victoria Square, CastleCourt, the centres',
    // 'shopping' geocoded to something and the results read "25 spots near
    // shopping". A place name reads correctly and lands where the shops are.
    Icon: ShoppingBag, from: '#7CC4FF', to: '#6366F1', action: 'search', query: 'Victoria Square',
  },
  {
    id: 'nightout', title: 'Pubs & Nights Out', blurb: 'Cathedral Quarter and the centre',
    Icon: Beer, from: '#FFB4A2', to: '#E11D48', action: 'search', query: 'Cathedral Quarter',
  },
  {
    id: 'premium', title: 'Premium Hotspots', blurb: 'The spots locals keep quiet',
    Icon: Sparkles, from: '#C9A7FF', to: '#5BE7DA', action: 'premium', premium: true,
  },
];

const CategoryCard = ({ cat, isPremium, onSelect }) => {
  const { Icon } = cat;
  return (
    <button
      onClick={() => onSelect(cat)}
      className="pe-pressable"
      aria-label={`${cat.title} — ${cat.blurb}`}
      style={{
        // Uniform aspect and a single internal grid: every tile is the same
        // shape whatever the length of its title, which is most of what makes
        // a grid read as designed rather than assembled.
        position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        textAlign: 'left', width: '100%', aspectRatio: '1 / 0.92',
        padding: space[3], borderRadius: radius.xl, cursor: 'pointer',
        background: color.surface, border: `1px solid ${color.hairline}`,
        boxShadow: elevation.sm, overflow: 'hidden',
        transition: `transform ${motion.fast} ${motion.ease}, border-color ${motion.base} ${motion.ease}`,
      }}
    >
      {/* Tint bleeding from the icon corner — gives each tile its own identity
          without six competing background images. */}
      <span aria-hidden style={{
        position: 'absolute', inset: 0, opacity: 0.16, pointerEvents: 'none',
        background: `radial-gradient(120% 90% at 0% 0%, ${cat.to} 0%, transparent 60%)`,
      }} />
      <span style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{
          width: 38, height: 38, borderRadius: radius.md, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: `linear-gradient(135deg, ${cat.from}, ${cat.to})`,
          boxShadow: elevation.sm,
        }}>
          <Icon size={19} color={color.brandInk} strokeWidth={2.4} />
        </span>
        {cat.premium && !isPremium && <Badge tone="premium">★</Badge>}
      </span>
      <span style={{ position: 'relative', display: 'block' }}>
        <Text role="h3" style={{ display: 'block' }}>{cat.title}</Text>
        <Text role="caption" tone="faint" style={{ display: 'block', marginTop: space[1] }}>{cat.blurb}</Text>
      </span>
    </button>
  );
};

/**
 * onSelect receives the category. The parent decides what each action means,
 * so this component never reaches into app state and can be dropped onto any
 * screen — including, later, a web landing page for SEO.
 */
export default function CategoryGrid({ isPremium, onSelect, cityName }) {
  return (
    <section style={{ padding: `0 ${space[4]}` }} aria-labelledby="pe-browse-heading">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: space[3] }}>
        <div>
          <Overline>Browse{cityName ? ` · ${cityName}` : ''}</Overline>
          <Text as="h2" id="pe-browse-heading" role="h2" style={{ display: 'block', marginTop: space[1] }}>
            What are you parking for?
          </Text>
        </div>
      </div>
      {/* Column count is CSS, not inline: two on a phone, three from 640px and
          four from 1024px. Left at two, a tile on a 1180px shell became ~570px
          tall — the aspect ratio that makes a phone grid feel deliberate makes
          a desktop grid look broken. */}
      <div className="pe-cat-grid" style={{ display: 'grid', gap: space[3] }}>
        {CATEGORIES.map(cat => (
          <CategoryCard key={cat.id} cat={cat} isPremium={isPremium} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

export { CategoryCard };
