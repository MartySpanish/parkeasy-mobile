import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapPin, Search, Crosshair, Plus, Building2, Navigation,
  Bookmark, Camera, Check, X, ChevronRight, Share2,
  Map, Star, Clock, Car, Info, LogOut, User,
} from 'lucide-react';

// ── Leaflet icon fix ──────────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const pinSvg = (fill, letter) =>
  `<svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 26 14 26S28 24.5 28 14C28 6.27 21.73 0 14 0z"
      fill="${fill}" stroke="white" stroke-width="2.5"/>
    <text x="14" y="19" text-anchor="middle" font-family="system-ui,sans-serif"
      font-size="10" font-weight="700" fill="white">${letter}</text>
  </svg>`;

const mkPin = (fill, letter) => L.divIcon({
  className: '',
  html: pinSvg(fill, letter),
  iconSize: [28, 40], iconAnchor: [14, 40], popupAnchor: [0, -40],
});

const PIN = {
  free:       mkPin('#22c55e', 'F'),
  hidden_gem: mkPin('#a855f7', '★'),
  timed:      mkPin('#f59e0b', 'T'),
  paid:       mkPin('#ef4444', '£'),
  official:   mkPin('#1a2332', 'P'),
};

const BADGES = {
  free:       { label: 'FREE',          bg: '#dcfce7', fg: '#15803d' },
  hidden_gem: { label: '💎 Hidden Gem', bg: '#f3e8ff', fg: '#7e22ce' },
  timed:      { label: 'TIMED',         bg: '#fff7ed', fg: '#9a3412' },
  paid:       { label: 'PAY & DISPLAY', bg: '#fef9c3', fg: '#92400e' },
  official:   { label: '🅿 Official',    bg: '#dbeafe', fg: '#1e3a5f' },
};

// ── Seed data ─────────────────────────────────────────────────────────────────
const SPOTS = [
  { id:1,  name:'Directly outside — Gransha Grill',   near:'Gransha Grill',    tags:['gransha grill','gransha road'],                      badge:'free',       dist:0.00, walk:'Right outside', restriction:'No restrictions',              notes:'Park right outside the door — 2–3 cars fit easily. Free all day, no signage spotted.', lat:54.5825, lng:-5.9758, by:'GranshaLocal',        votes:61, photo:'https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=600&h=400&fit=crop', price:null,      spaces:3    },
  { id:2,  name:'Gransha Road Lay-by (north side)',   near:'Gransha Grill',    tags:['gransha grill','gransha road'],                      badge:'free',       dist:0.04, walk:'1 min',          restriction:'Free all day',                 notes:'Wider lay-by fits 4+ cars, 1 min walk back. Locals use this daily — never seen a warden.', lat:54.5830, lng:-5.9762, by:'RegularDiner',        votes:44, photo:'https://images.unsplash.com/photo-1486006920555-c77dcf18193c?w=600&h=400&fit=crop', price:null,      spaces:5    },
  { id:3,  name:'Side road off Gransha Road',         near:'Gransha Grill',    tags:['gransha grill','gransha'],                           badge:'hidden_gem', dist:0.07, walk:'2 min',          restriction:'Evenings & weekends fine',     notes:'Quiet residential street, no wardens ever spotted. Walk right back to the Grill.', lat:54.5835, lng:-5.9768, by:'ParkingPro_BT',      votes:29, photo:null,                                                                                          price:null,      spaces:8    },
  { id:4,  name:'Trailhead gravel area',              near:'Black Mountain',   tags:['black mountain','black mountain walk','hiking'],     badge:'free',       dist:0.00, walk:'Trail start',    restriction:'Free all day',                 notes:"Gets busy weekends — arrive before 10am or you'll be circling. Gravel surface, 15–20 cars.", lat:54.6198, lng:-6.0225, by:'HikerBelfast',       votes:88, photo:'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=400&fit=crop', price:null,      spaces:20   },
  { id:5,  name:'Hannahstown Hill roadside verge',    near:'Black Mountain',   tags:['black mountain','black mountain walk','hannahstown'],badge:'hidden_gem', dist:0.25, walk:'~5 min',         restriction:'No restrictions',              notes:'Wide verge fits 6+ easily. Better than the main area on busy days — most tourists miss it.', lat:54.6175, lng:-6.0190, by:'DogWalkerDermot',   votes:52, photo:'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=600&h=400&fit=crop', price:null,      spaces:7    },
  { id:6,  name:'Whiterock Road lay-by',              near:'Black Mountain',   tags:['black mountain','black mountain walk','whiterock'],  badge:'free',       dist:0.38, walk:'~8 min',         restriction:'Free all day',                 notes:'Alternative start point, less crowded. Walk up through Whiterock — great views on the way.', lat:54.6150, lng:-6.0150, by:'Springfield_Regular',votes:31, photo:null,                                                                                          price:null,      spaces:6    },
  { id:7,  name:'Glen Road on-street (outside)',      near:'Glen Road barber', tags:['glen road barber','tommy barber','glen road'],       badge:'timed',      dist:0.00, walk:'Outside',        restriction:'Mon–Sat 9am–5pm timed',        notes:'Check yellow lines carefully. Usually fine evenings and Sundays — quick in-and-out for a cut.', lat:54.5935, lng:-6.0012, by:'GlenRoadRegular',    votes:55, photo:'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=600&h=400&fit=crop', price:null,      spaces:4    },
  { id:8,  name:'Bingnian Drive',                     near:'Glen Road barber', tags:['glen road barber','tommy barber','bingnian'],        badge:'free',       dist:0.05, walk:'~2 min',         restriction:'Free, unrestricted',           notes:'Quiet side street, 2 min walk to the barber. Community confirmed no restrictions.', lat:54.5940, lng:-6.0025, by:'NansenNeighbour',    votes:38, photo:null,                                                                                          price:null,      spaces:10   },
  { id:9,  name:'Falls Road on-street',               near:'Falls Road',       tags:['falls road','west belfast fitness','felons','roma pizza','andersonstown'], badge:'paid', dist:0.00, walk:'On the road', restriction:'Mon–Sat 9am–6pm Pay & Display', notes:'Free evenings and Sundays. Pay & Display machine on the road. £1/hr during restricted hours.', lat:54.5965, lng:-5.9720, by:'FallsRoadFred', votes:73, photo:'https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=600&h=400&fit=crop', price:'£1.00/hr', spaces:null },
  { id:10, name:'Dunlewey Street',                    near:'Falls Road',       tags:['falls road','west belfast fitness'],                 badge:'free',       dist:0.06, walk:'~2 min',         restriction:'Unrestricted',                 notes:'Community confirmed no restrictions on this quiet side street. Always a space here.', lat:54.5970, lng:-5.9740, by:'ClowneyLocal',       votes:47, photo:null,                                                                                          price:null,      spaces:12   },
  { id:11, name:'International Wall lay-by',          near:'Falls Road',       tags:['falls road','murals','international wall'],          badge:'hidden_gem', dist:0.09, walk:'~3 min',         restriction:'Free, no restrictions',        notes:'Handy for quick visits beside the murals. Hidden gem — rarely full even on tourist days.', lat:54.5975, lng:-5.9695, by:'DivisDweller',       votes:33, photo:'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=400&fit=crop', price:null,      spaces:6    },
  { id:12, name:'Belfast Castle car park',            near:'Cave Hill',        tags:['cave hill','belfast castle','napoleons nose'],       badge:'free',       dist:0.00, walk:'1 min',          restriction:'Free all day',                 notes:"Fills up on sunny weekends — arrive before noon. Official free car park, well maintained.", lat:54.6375, lng:-5.9605, by:'CaveHillClimber',    votes:97, photo:'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=600&h=400&fit=crop', price:null,      spaces:80   },
  { id:13, name:'Innisfayle Park overflow',           near:'Cave Hill',        tags:['cave hill','innisfayle','antrim road'],              badge:'hidden_gem', dist:0.19, walk:'~7 min',         restriction:'Residential — be respectful', notes:'When the castle car park is rammed, locals use this quiet road. Always space. Short walk up.', lat:54.6350, lng:-5.9580, by:'AntrimRoadAndy',     votes:51, photo:null,                                                                                          price:null,      spaces:null },
  { id:14, name:'Boucher Road area streets',          near:'Balmoral Show',    tags:['balmoral show','boucher road','kings hall'],         badge:'free',       dist:0.35, walk:'~8 min',         restriction:'Show days — community use',    notes:'Community park in surrounding streets and walk. Saves a fortune vs official show parking.', lat:54.5710, lng:-5.9420, by:'ShowGoer',           votes:66, photo:'https://images.unsplash.com/photo-1519125323398-675f0ddb6308?w=600&h=400&fit=crop', price:null,      spaces:null },
  { id:15, name:'Tates Avenue',                       near:'Balmoral Show',    tags:['balmoral show','tates avenue'],                     badge:'free',       dist:0.90, walk:'~15 min',        restriction:'No restrictions',              notes:'15 min walk saves the show parking charges entirely. Well used on show days.', lat:54.5720, lng:-5.9370, by:'BalmoralBargain',     votes:44, photo:null,                                                                                          price:null,      spaces:null },
  { id:16, name:'NCP Victoria Square',                near:'City Centre',      tags:['city centre','victoria square','ncp','belfast city centre'], badge:'official', dist:0.10, walk:'2 min', restriction:'Open 24/7',                    notes:'NCP multi-storey. 1,000 spaces. Close to Victoria Square mall and Waterfront.', lat:54.5973, lng:-5.9260, by:'NCP Belfast',         votes:0,  photo:'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=600&h=400&fit=crop', price:'£2.00/hr', spaces:1000 },
  { id:17, name:'NCP Dunbar Link',                    near:'City Centre',      tags:['city centre','dunbar link','ncp'],                   badge:'official',   dist:0.20, walk:'4 min',          restriction:'Open 24/7',                    notes:'NCP multi-storey. Great for Cathedral Quarter and Titanic Quarter access.', lat:54.5998, lng:-5.9270, by:'NCP Belfast',         votes:0,  photo:null,                                                                                          price:'£1.80/hr', spaces:600  },
  { id:18, name:'Q-Park Obel',                        near:'City Centre',      tags:['city centre','obel','qpark','donegall quay'],        badge:'official',   dist:0.15, walk:'3 min',          restriction:'Open 24/7',                    notes:'Q-Park at the Obel tower. Modern facility, handy for Titanic Quarter.', lat:54.6008, lng:-5.9245, by:'Q-Park Belfast',      votes:0,  photo:null,                                                                                          price:'£2.50/hr', spaces:500  },
  { id:19, name:'Q-Park Victoria Square',             near:'City Centre',      tags:['city centre','victoria square','qpark'],             badge:'official',   dist:0.05, walk:'1 min',          restriction:'Open 24/7',                    notes:'Q-Park inside Victoria Square. Validated parking available in some stores.', lat:54.5975, lng:-5.9255, by:'Q-Park Belfast',      votes:0,  photo:null,                                                                                          price:'£2.20/hr', spaces:700  },
  { id:20, name:'BCC Bankmore Square',                near:'City Centre',      tags:['city centre','bankmore','belfast city council'],     badge:'official',   dist:0.30, walk:'6 min',          restriction:'Mon–Sat 8am–6pm',              notes:'Belfast City Council operated. Good rates. Short walk to City Hall.', lat:54.5940, lng:-5.9300, by:'Belfast City Council', votes:0,  photo:null,                                                                                          price:'£1.50/hr', spaces:400  },
  { id:21, name:'BCC Castle Street',                  near:'City Centre',      tags:['city centre','castle street','belfast city council'],badge:'official',   dist:0.10, walk:'2 min',          restriction:'Mon–Sat 8am–6pm',              notes:'Central city council car park. Good for Royal Avenue shopping.', lat:54.5985, lng:-5.9335, by:'Belfast City Council', votes:0,  photo:null,                                                                                          price:'£1.60/hr', spaces:300  },
  { id:22, name:'BCC Tomb Street',                    near:'City Centre',      tags:['city centre','tomb street','belfast city council'],  badge:'official',   dist:0.20, walk:'4 min',          restriction:'Mon–Sat 8am–6pm',              notes:'Good for Cathedral Quarter and Custom House Square area.', lat:54.6002, lng:-5.9280, by:'Belfast City Council', votes:0,  photo:null,                                                                                          price:'£1.40/hr', spaces:350  },
];

const BUSINESSES = [
  { id:1, name:"Tommy's Barber",       area:'Glen Road',     addr:'245 Glen Road, West Belfast BT11', cat:'Barber',      icon:'✂️', key:'glen road barber', lat:54.5935, lng:-6.0012 },
  { id:2, name:'Gransha Grill',        area:'Hannahstown',   addr:'Gransha Road, BT17',               cat:'Restaurant',  icon:'🍽️', key:'gransha grill',    lat:54.5825, lng:-5.9758 },
  { id:3, name:'West Belfast Fitness', area:'Falls Road',    addr:'Falls Road, West Belfast BT12',    cat:'Gym',         icon:'💪', key:'falls road',       lat:54.5965, lng:-5.9720 },
  { id:4, name:'The Felons Club',      area:'Andersonstown', addr:'Andersonstown Road, BT11',         cat:'Social Club', icon:'🍺', key:'falls road',       lat:54.5870, lng:-5.9870 },
  { id:5, name:"Roma's Pizza",         area:'Andersonstown', addr:'Andersonstown Road, BT11',         cat:'Restaurant',  icon:'🍕', key:'falls road',       lat:54.5875, lng:-5.9875 },
];

const SUGGESTIONS = [
  'Gransha Grill','Black Mountain walk','Glen Road barber',
  'Falls Road','Cave Hill','Balmoral Show','City Centre',
];

// ── Utilities ─────────────────────────────────────────────────────────────────
const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const isFreeNow = (spot) => {
  if (['free','hidden_gem','official'].includes(spot.badge)) return null;
  const r = (spot.restriction||'').toLowerCase();
  if (r.includes('24/7')||r.includes('no restrict')||r.includes('unrestrict')) return null;
  const now = new Date();
  const day = now.getDay();
  const h = now.getHours() + now.getMinutes()/60;
  const monSat = r.includes('mon')&&r.includes('sat');
  const monFri = r.includes('mon')&&r.includes('fri');
  const restrictedToday = monSat ? day>=1&&day<=6 : monFri ? day>=1&&day<=5 : true;
  if (!restrictedToday) return true;
  const m = r.match(/(\d+)am[–\-](\d+)pm/);
  if (m) { const s=parseInt(m[1]), e=parseInt(m[2])+12; if (h<s||h>=e) return true; }
  return false;
};

const directionsUrl = (lat, lng) => {
  const isIOS = /ipad|iphone|ipod/i.test(navigator.userAgent) && !window.MSStream;
  return isIOS
    ? `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
};

const ls = {
  get: (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ── Badge ─────────────────────────────────────────────────────────────────────
const Badge = ({ type }) => {
  const cfg = BADGES[type] || BADGES.free;
  return (
    <span style={{ background:cfg.bg, color:cfg.fg }}
      className="text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap">
      {cfg.label}
    </span>
  );
};

// ── Welcome / Auth Modal ──────────────────────────────────────────────────────
const WelcomeModal = ({ onJoin, onSkip }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const submit = (e) => {
    e.preventDefault();
    onJoin({ name: name.trim(), email: email.trim(), joined: new Date().toISOString(), spotsAdded: 0 });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-[200] flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header strip */}
        <div style={{ background:'#1a2332' }} className="p-6 text-center">
          <div className="w-14 h-14 bg-[#4a9eff] rounded-2xl flex items-center justify-center mx-auto mb-3">
            <MapPin size={28} className="text-white" />
          </div>
          <h2 className="text-white font-extrabold text-xl">Welcome to ParkEasy</h2>
          <p className="text-blue-300 text-sm mt-0.5">Belfast's community parking finder</p>
        </div>

        <div className="p-6 space-y-4">
          {/* Features */}
          <div className="space-y-2">
            {[
              ['🟢','Find free spots locals actually use'],
              ['💎','Discover hidden gems off the main roads'],
              ['🏆','Add spots and earn free Premium'],
            ].map(([icon, text]) => (
              <div key={text} className="flex items-center gap-3 text-sm text-gray-700">
                <span>{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3 pt-1">
            <input
              required value={name} onChange={e=>setName(e.target.value)}
              placeholder="Your name"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff]"
            />
            <input
              required type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff]"
            />
            <button type="submit"
              className="w-full bg-[#4a9eff] text-white py-3.5 rounded-xl font-bold text-sm hover:bg-blue-500 transition shadow-md">
              Join the community — it's free
            </button>
          </form>

          <button onClick={onSkip}
            className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-1">
            Browse without signing up →
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Business Listing Modal ────────────────────────────────────────────────────
const BusinessModal = ({ onClose }) => {
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ name:'', address:'', email:'', phone:'' });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  if (done) return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm p-8 text-center space-y-4 shadow-2xl">
        <div className="w-16 h-16 bg-[#dcfce7] rounded-full flex items-center justify-center mx-auto">
          <Check size={32} className="text-[#15803d]" />
        </div>
        <h3 className="text-xl font-bold text-gray-900">Request Received!</h3>
        <p className="text-sm text-gray-500 leading-relaxed">
          We'll add your business to the directory and map your nearest parking spots within 24 hours.
        </p>
        <button onClick={onClose}
          className="w-full bg-[#1a2332] text-white py-3 rounded-xl font-bold hover:bg-[#243447] transition">
          Done
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-[200] flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">List Your Business Free</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <div className="p-6">
          <p className="text-sm text-gray-500 mb-4 leading-relaxed">
            Customers searching for your business will see exactly where to park. Free forever.
          </p>
          <form onSubmit={e=>{e.preventDefault();setDone(true);}} className="space-y-3">
            <input required value={form.name} onChange={e=>set('name',e.target.value)}
              placeholder="Business name *"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff]" />
            <input required value={form.address} onChange={e=>set('address',e.target.value)}
              placeholder="Full address *"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff]" />
            <input required type="email" value={form.email} onChange={e=>set('email',e.target.value)}
              placeholder="Contact email *"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff]" />
            <input value={form.phone} onChange={e=>set('phone',e.target.value)}
              placeholder="Phone number (optional)"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff]" />
            <button type="submit"
              className="w-full bg-[#4a9eff] text-white py-3.5 rounded-xl font-bold text-sm hover:bg-blue-500 transition shadow-md">
              Submit for free listing
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// ── Pricing / Premium Modal ───────────────────────────────────────────────────
const STRIPE_MONTHLY = 'https://buy.stripe.com/00w4gscgJ6QoahjcTU0kE01';
const STRIPE_ANNUAL  = 'https://buy.stripe.com/5kQ6oA1C5eiQ0GJg660kE00';

const PricingModal = ({ isPremium, onClose }) => {

  if (isPremium) return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm p-8 text-center space-y-4 shadow-2xl">
        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto">
          <Star size={32} className="text-yellow-500" fill="#eab308"/>
        </div>
        <h3 className="text-xl font-bold text-gray-900">You're Premium! ★</h3>
        <p className="text-sm text-gray-500 leading-relaxed">
          Full access to all ParkEasy Premium features. Thanks for supporting Belfast's community parking finder!
        </p>
        <button onClick={onClose}
          className="w-full bg-[#1a2332] text-white py-3 rounded-xl font-bold hover:bg-[#243447] transition">
          Done
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-[200] flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div style={{ background: 'linear-gradient(135deg,#1a2332 0%,#2d4a6e 100%)' }} className="p-6 text-center relative">
          <button onClick={onClose} className="absolute top-4 right-4 text-blue-300 hover:text-white"><X size={20}/></button>
          <div className="w-14 h-14 bg-yellow-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Star size={28} fill="currentColor" className="text-yellow-900"/>
          </div>
          <h2 className="text-white font-extrabold text-xl">ParkEasy Premium</h2>
          <p className="text-blue-300 text-sm mt-0.5">Support Belfast's community parking finder</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-2.5">
            {[
              ['⚡','Priority spot updates & real-time alerts'],
              ['🗺️','Offline map — works without signal'],
              ['🔔','Get notified when spots free up'],
              ['💎','Premium badge on your profile'],
              ['❤️','Keep ParkEasy free for the whole community'],
            ].map(([icon,text])=>(
              <div key={text} className="flex items-center gap-3 text-sm text-gray-700">
                <span className="text-base w-6 text-center">{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <a href={STRIPE_MONTHLY} target="_blank" rel="noreferrer"
              className="block rounded-2xl border-2 border-[#4a9eff] p-3 text-center hover:bg-blue-50 transition">
              <p className="text-xs text-[#4a9eff] font-bold uppercase tracking-wide mb-1">Monthly</p>
              <p className="text-2xl font-extrabold text-gray-900">£2.99</p>
              <p className="text-xs text-gray-500">per month</p>
              <span className="mt-2 block w-full bg-[#4a9eff] text-white py-2 rounded-xl text-xs font-bold">
                Subscribe
              </span>
            </a>
            <a href={STRIPE_ANNUAL} target="_blank" rel="noreferrer"
              className="block rounded-2xl border-2 border-[#1a2332] p-3 text-center hover:bg-gray-50 transition relative">
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-yellow-400 text-yellow-900 text-[9px] font-black px-2 py-0.5 rounded-full whitespace-nowrap">BEST VALUE</span>
              <p className="text-xs text-[#1a2332] font-bold uppercase tracking-wide mb-1">Annual</p>
              <p className="text-2xl font-extrabold text-gray-900">£20</p>
              <p className="text-xs text-gray-500">per year</p>
              <span className="mt-2 block w-full bg-[#1a2332] text-white py-2 rounded-xl text-xs font-bold">
                Subscribe
              </span>
            </a>
          </div>
          <p className="text-center text-xs text-gray-400">Secure payment via Stripe · Cancel any time</p>
        </div>
      </div>
    </div>
  );
};

// ── User Menu ─────────────────────────────────────────────────────────────────
const UserMenu = ({ user, spotsAdded, isPremium, onSignOut, onUpgrade, onClose }) => (
  <div className="fixed inset-0 z-[150]" onClick={onClose}>
    <div
      className="absolute top-16 right-3 bg-white rounded-2xl shadow-2xl border border-gray-100 w-64 overflow-hidden"
      onClick={e=>e.stopPropagation()}
    >
      <div style={{background:'#1a2332'}} className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-[#4a9eff] rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-white font-bold text-sm truncate">{user.name}</p>
          <p className="text-blue-300 text-xs truncate">{user.email}</p>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Spots added</span>
          <span className="font-bold text-gray-900">{spotsAdded}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Premium</span>
          {isPremium
            ? <span className="font-bold text-yellow-600">★ Active</span>
            : <button onClick={onUpgrade}
                className="font-bold text-[#4a9eff] text-xs hover:text-blue-600 underline">
                Upgrade £2.99/mo →
              </button>
          }
        </div>
        <div className="pt-1 border-t border-gray-100">
          <button
            onClick={onSignOut}
            className="w-full flex items-center gap-2 text-sm text-red-600 hover:text-red-700 font-medium py-1"
          >
            <LogOut size={15}/> Sign out
          </button>
        </div>
      </div>
    </div>
  </div>
);

// ── SpotCard ──────────────────────────────────────────────────────────────────
const SpotCard = ({ spot, saved, onSave, rating, onRate }) => {
  const [shareDone, setShareDone] = useState(false);
  const isOfficial = ['NCP Belfast','Q-Park Belfast','Belfast City Council'].includes(spot.by);
  const freeNow = isFreeNow(spot);

  const handleShare = async () => {
    const text = `${spot.name} — ${spot.notes.slice(0,100)}`;
    const url = 'https://martyspanish.github.io/parkeasy-mobile/';
    if (navigator.share) {
      try { await navigator.share({ title:'ParkEasy Belfast', text, url }); } catch {}
    } else {
      navigator.clipboard?.writeText(`${spot.name}\n${text}\n${url}`);
      setShareDone(true);
      setTimeout(()=>setShareDone(false), 2200);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div
        className="relative h-40 overflow-hidden flex items-center justify-center"
        style={{ background: spot.photo ? undefined : 'linear-gradient(135deg,#1a2332 0%,#2d4a6e 100%)' }}
      >
        {spot.photo
          ? <img src={spot.photo} alt={spot.name} className="w-full h-full object-cover" loading="lazy"/>
          : <Car size={44} className="text-white opacity-20"/>}
        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
          <Badge type={spot.badge}/>
          {freeNow === true && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-500 text-white animate-pulse">
              Free right now
            </span>
          )}
        </div>
        {spot.price && (
          <div className="absolute top-2 right-10 bg-black bg-opacity-70 text-white text-xs font-bold px-2 py-1 rounded-full">
            {spot.price}
          </div>
        )}
        <button onClick={()=>onSave(spot.id)}
          className="absolute top-2 right-2 w-8 h-8 bg-white rounded-full shadow flex items-center justify-center hover:scale-110 transition-transform">
          <Bookmark size={15} className={saved?'text-[#4a9eff]':'text-gray-400'} fill={saved?'#4a9eff':'none'}/>
        </button>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-bold text-gray-900 text-sm leading-snug flex-1">{spot.name}</h3>
          <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{spot.walk}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Clock size={11}/>{spot.restriction}</span>
          {spot.spaces!=null && <span className="flex items-center gap-1"><Car size={11}/>{spot.spaces} spaces</span>}
        </div>
        <div className="border-l-4 border-[#4a9eff] pl-3 mb-3">
          <p className="text-sm text-gray-600 italic leading-relaxed line-clamp-2">{spot.notes}</p>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <a href={directionsUrl(spot.lat,spot.lng)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-xs bg-[#4a9eff] text-white px-3 py-1.5 rounded-full font-semibold hover:bg-blue-500 transition">
            <Navigation size={11}/>Directions
          </a>
          <button onClick={handleShare}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold border transition ${
              shareDone ? 'bg-green-50 border-green-300 text-green-700' : 'border-gray-200 text-gray-600 hover:border-[#4a9eff] hover:text-[#4a9eff]'
            }`}>
            {shareDone ? <><Check size={11}/>Copied!</> : <><Share2 size={11}/>Share</>}
          </button>
          <div className="ml-auto text-xs text-gray-400">
            {isOfficial
              ? <span className="font-semibold text-[#1e3a5f]">{spot.by}</span>
              : <span className="flex items-center gap-1"><Star size={11} className="text-yellow-400" fill="#facc15"/>{spot.votes} confirmed</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-400 flex-1">Still accurate?</span>
          <button onClick={()=>onRate(spot.id,'accurate')}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              rating==='accurate' ? 'bg-green-50 border-green-300 text-green-700 font-semibold' : 'border-gray-200 text-gray-500 hover:border-green-300 hover:text-green-600'
            }`}>✓ Yes</button>
          <button onClick={()=>onRate(spot.id,'changed')}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              rating==='changed' ? 'bg-amber-50 border-amber-300 text-amber-700 font-semibold' : 'border-gray-200 text-gray-500 hover:border-amber-300 hover:text-amber-600'
            }`}>⚠ Changed</button>
        </div>
      </div>
    </div>
  );
};

// ── Map helpers ───────────────────────────────────────────────────────────────
const RecenterMap = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => { if(center) map.setView(center, zoom, {animate:true}); }, [center[0],center[1],zoom]);
  return null;
};

const ParkingMap = ({ spots, center, zoom=14, height=220, onSelect }) => (
  <div style={{height}} className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
    <MapContainer center={center||[54.5973,-5.9301]} zoom={zoom}
      style={{width:'100%',height:'100%'}} scrollWheelZoom={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'/>
      {center && <RecenterMap center={center} zoom={zoom}/>}
      {spots.map(s=>(
        <Marker key={s.id} position={[s.lat,s.lng]} icon={PIN[s.badge]||PIN.free}
          eventHandlers={{click:()=>onSelect&&onSelect(s)}}>
          <Popup>
            <div style={{minWidth:160}}>
              <p className="font-bold text-sm mb-1">{s.name}</p>
              <Badge type={s.badge}/>
              {s.price && <p className="text-xs mt-1 font-semibold">{s.price}</p>}
              <p className="text-xs text-gray-600 mt-1">{s.notes.slice(0,90)}…</p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  </div>
);

// ── SearchTab ─────────────────────────────────────────────────────────────────
const SearchTab = ({ saved, onSave, ratings, onRate, recentSearches, onSearch }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [mapCenter, setMapCenter] = useState(null);
  const [showMap, setShowMap] = useState(true);
  const [badgeFilter, setBadgeFilter] = useState('all');
  const inputRef = useRef(null);

  const doSearch = useCallback((q) => {
    const lq = q.toLowerCase().trim();
    if (!lq) { setResults([]); return; }
    const res = SPOTS.filter(s =>
      s.tags.some(t=>t.includes(lq)) || s.name.toLowerCase().includes(lq) || s.near.toLowerCase().includes(lq)
    );
    setResults(res);
    setBadgeFilter('all');
    if (res.length) setMapCenter([res[0].lat, res[0].lng]);
  }, []);

  const handleInput = (val) => {
    setQuery(val);
    setSuggestions(val.length>1 ? SUGGESTIONS.filter(s=>s.toLowerCase().includes(val.toLowerCase())) : []);
    setShowSugg(val.length>1);
    if (val.length>2) doSearch(val);
    else if (!val) setResults([]);
  };

  const pick = (s) => { setQuery(s); setShowSugg(false); doSearch(s); onSearch(s); inputRef.current?.blur(); };
  const clear = () => { setQuery(''); setResults([]); setShowSugg(false); };

  const badgesInResults = results.length ? ['all',...new Set(results.map(r=>r.badge))] : [];
  const displayed = badgeFilter==='all' ? results : results.filter(r=>r.badge===badgeFilter);

  return (
    <div className="p-4 space-y-4">
      <div className="relative">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
        <input ref={inputRef} value={query} onChange={e=>handleInput(e.target.value)}
          onKeyDown={e=>{ if(e.key==='Enter'){doSearch(query);onSearch(query);setShowSugg(false);} }}
          placeholder="Try 'Gransha Grill' or 'Cave Hill'…"
          className="w-full pl-10 pr-10 py-3.5 rounded-xl border border-gray-200 bg-white shadow-sm text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a9eff]"
        />
        {query && (
          <button onClick={clear} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={16}/>
          </button>
        )}
        {showSugg && suggestions.length>0 && (
          <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-50 mt-1 overflow-hidden">
            {suggestions.map(s=>(
              <button key={s} onClick={()=>pick(s)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 text-sm text-gray-700 flex items-center gap-2 border-b border-gray-100 last:border-0">
                <Search size={13} className="text-[#4a9eff]"/>{s}
              </button>
            ))}
          </div>
        )}
      </div>

      {!results.length && (
        <>
          {recentSearches.length>0 && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-2">Recent</p>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map(s=>(
                  <button key={s} onClick={()=>pick(s)}
                    className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full hover:border-[#4a9eff] hover:text-[#4a9eff] transition shadow-sm flex items-center gap-1">
                    <Clock size={10}/>{s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-2">Popular searches</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s=>(
                <button key={s} onClick={()=>pick(s)}
                  className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full hover:border-[#4a9eff] hover:text-[#4a9eff] transition shadow-sm">
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-[#1a2332] to-[#2d4a6e] p-5 text-white">
            <p className="text-xs uppercase tracking-widest text-blue-300 mb-1">Community-powered</p>
            <h2 className="text-lg font-bold mb-2">Find where locals actually park</h2>
            <p className="text-sm text-blue-200 leading-relaxed">
              Street spots, lay-bys, hidden gems and official car parks — all in one place for Belfast.
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              {Object.entries(BADGES).map(([key,cfg])=>(
                <span key={key} style={{background:cfg.bg,color:cfg.fg}}
                  className="text-xs font-bold px-2.5 py-1 rounded-full">{cfg.label}</span>
              ))}
            </div>
          </div>
        </>
      )}

      {results.length>0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              <span className="font-bold text-gray-900">{displayed.length}</span> spots near{' '}
              <span className="text-[#4a9eff] font-semibold">"{query}"</span>
            </p>
            <button onClick={()=>setShowMap(m=>!m)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-semibold transition ${
                showMap ? 'bg-[#1a2332] text-white border-[#1a2332]' : 'bg-white text-gray-600 border-gray-200'
              }`}>
              <Map size={13}/>{showMap?'Hide map':'Show map'}
            </button>
          </div>

          {badgesInResults.length>2 && (
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {badgesInResults.map(b=>{
                const cfg = b==='all' ? {label:'All',bg:'#f3f4f6',fg:'#374151'} : BADGES[b];
                const active = badgeFilter===b;
                return (
                  <button key={b} onClick={()=>setBadgeFilter(b)}
                    style={active ? {background:cfg.bg,color:cfg.fg} : {}}
                    className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap font-semibold transition flex-shrink-0 ${
                      active ? 'border-current shadow-sm' : 'border-gray-200 text-gray-500 bg-white'
                    }`}>
                    {cfg?.label||b}
                  </button>
                );
              })}
            </div>
          )}

          {showMap && mapCenter && <ParkingMap spots={displayed} center={mapCenter} zoom={13} height={210}/>}

          <div className="space-y-4">
            {displayed.map(s=>(
              <SpotCard key={s.id} spot={s} saved={saved.has(s.id)} onSave={onSave}
                rating={ratings[s.id]} onRate={onRate}/>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ── NearbyTab ─────────────────────────────────────────────────────────────────
const NearbyTab = ({ saved, onSave, ratings, onRate }) => {
  const [loc, setLoc] = useState(null);
  const [nearby, setNearby] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const buildNearby = useCallback((lat,lng) => {
    const sorted = SPOTS.map(s=>({...s,realDist:haversine(lat,lng,s.lat,s.lng)}))
      .sort((a,b)=>a.realDist-b.realDist).slice(0,10);
    setNearby(sorted);
    setLoading(false);
  },[]);

  const findNearby = () => {
    setLoading(true); setErr('');
    navigator.geolocation.getCurrentPosition(
      ({coords:{latitude:lat,longitude:lng}})=>{ setLoc([lat,lng]); buildNearby(lat,lng); },
      ()=>{ const lat=54.5973,lng=-5.9301; setLoc([lat,lng]); buildNearby(lat,lng); setErr('Location access denied — showing spots from Belfast city centre.'); }
    );
  };

  if (!loc) return (
    <div className="p-8 flex flex-col items-center text-center space-y-5">
      <div className="w-20 h-20 bg-[#eef5ff] rounded-full flex items-center justify-center">
        <Crosshair size={38} className="text-[#4a9eff]"/>
      </div>
      <h3 className="text-lg font-bold text-gray-900">Parking Spots Near You</h3>
      <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
        Use your location to find the closest community-verified parking spots in Belfast.
      </p>
      <button onClick={findNearby} disabled={loading}
        className="flex items-center gap-2 bg-[#4a9eff] text-white px-6 py-3.5 rounded-xl font-semibold hover:bg-blue-500 transition disabled:opacity-60 shadow-md">
        {loading ? '⏳ Locating…' : <><Crosshair size={18}/>Use My Location</>}
      </button>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {err && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2.5 rounded-xl">
          <Info size={14} className="mt-0.5 flex-shrink-0"/>{err}
        </div>
      )}
      <ParkingMap spots={nearby} center={loc} zoom={12} height={220}/>
      <p className="text-sm text-gray-600"><span className="font-bold text-gray-900">{nearby.length}</span> closest spots</p>
      <div className="space-y-4">
        {nearby.map(s=>(
          <SpotCard key={s.id} spot={{...s,dist:Math.round(s.realDist*10)/10}}
            saved={saved.has(s.id)} onSave={onSave} rating={ratings[s.id]} onRate={onRate}/>
        ))}
      </div>
    </div>
  );
};

// ── BusinessesTab ─────────────────────────────────────────────────────────────
const BusinessesTab = ({ onGetListed }) => {
  const [open, setOpen] = useState(null);

  return (
    <div className="p-4 space-y-3">
      <div className="bg-gradient-to-r from-[#1a2332] to-[#243447] text-white p-4 rounded-2xl">
        <p className="font-bold mb-0.5">Own a business?</p>
        <p className="text-sm text-blue-200 leading-relaxed">
          Get listed free — customers will see exactly where to park when they search for you.
        </p>
        <button onClick={onGetListed}
          className="mt-3 text-xs bg-[#4a9eff] text-white px-4 py-2 rounded-full font-semibold hover:bg-blue-400 transition">
          Get Listed Free →
        </button>
      </div>

      <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold pt-1">Belfast Business Directory</p>

      {BUSINESSES.map(b=>{
        const spots = SPOTS.filter(s=>s.tags.some(t=>t.includes(b.key)));
        const isOpen = open===b.id;
        return (
          <div key={b.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button onClick={()=>setOpen(isOpen?null:b.id)}
              className="w-full p-4 flex items-center gap-3 text-left hover:bg-gray-50 transition">
              <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                {b.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-sm">{b.name}</p>
                <p className="text-xs text-gray-500 truncate">{b.addr}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-400">{b.cat}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{background:'#dcfce7',color:'#15803d'}}>
                    {spots.length} parking spots
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className={`text-gray-300 transition-transform flex-shrink-0 ${isOpen?'rotate-90':''}`}/>
            </button>
            {isOpen && (
              <div className="border-t border-gray-100">
                {spots.length>0 && (
                  <div className="px-3 pt-3">
                    <ParkingMap spots={spots} center={[b.lat,b.lng]} zoom={15} height={180}/>
                  </div>
                )}
                <div className="p-3 space-y-2">
                  {spots.length===0
                    ? <p className="text-sm text-gray-400 text-center py-4">No spots yet — be the first to add one!</p>
                    : spots.map(s=>(
                      <div key={s.id} className="flex gap-3 p-3 bg-gray-50 rounded-xl">
                        {s.photo && <img src={s.photo} alt={s.name} className="w-16 h-16 object-cover rounded-lg flex-shrink-0"/>}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="font-semibold text-xs text-gray-900">{s.name}</span>
                            <Badge type={s.badge}/>
                          </div>
                          <p className="text-xs text-gray-500 line-clamp-2 italic">{s.notes}</p>
                          <p className="text-xs text-gray-400 mt-1">{s.walk} · {s.restriction}</p>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── SavedTab ──────────────────────────────────────────────────────────────────
const SavedTab = ({ saved, onSave, ratings, onRate }) => {
  const spots = SPOTS.filter(s=>saved.has(s.id));
  if (!spots.length) return (
    <div className="p-8 flex flex-col items-center text-center space-y-4">
      <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
        <Bookmark size={36} className="text-gray-300"/>
      </div>
      <h3 className="text-lg font-bold text-gray-900">No saved spots yet</h3>
      <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
        Tap the bookmark icon on any parking spot to save it here for quick access.
      </p>
    </div>
  );
  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-gray-600">
        <span className="font-bold text-gray-900">{spots.length}</span> saved spot{spots.length!==1?'s':''}
      </p>
      {spots.length>1 && <ParkingMap spots={spots} center={[spots[0].lat,spots[0].lng]} zoom={12} height={200}/>}
      <div className="space-y-4">
        {spots.map(s=>(
          <SpotCard key={s.id} spot={s} saved={true} onSave={onSave} rating={ratings[s.id]} onRate={onRate}/>
        ))}
      </div>
    </div>
  );
};

// ── AddSpotTab ────────────────────────────────────────────────────────────────
const AddSpotTab = ({ user, onJoinPrompt, onSpotAdded }) => {
  const [form, setForm] = useState({near:'',street:'',type:'',restriction:'',notes:''});
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);
  const SPOT_TYPES = ['Street parking','Lay-by','Car park','Side road','Grass verge','Private (shared)'];
  const RESTRICTIONS = ['Free all day','Time limited','Evenings free','Weekends free','No restrictions'];
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  if (!user) return (
    <div className="p-8 flex flex-col items-center text-center space-y-5">
      <div className="w-20 h-20 bg-[#eef5ff] rounded-full flex items-center justify-center">
        <User size={38} className="text-[#4a9eff]"/>
      </div>
      <h3 className="text-lg font-bold text-gray-900">Join to Add a Spot</h3>
      <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
        Sign up free to contribute parking spots and earn 1 month of Premium for every verified spot you add.
      </p>
      <button onClick={onJoinPrompt}
        className="flex items-center gap-2 bg-[#4a9eff] text-white px-6 py-3.5 rounded-xl font-semibold hover:bg-blue-500 transition shadow-md">
        Join Free — it takes 30 seconds
      </button>
    </div>
  );

  if (done) return (
    <div className="p-8 flex flex-col items-center text-center space-y-5">
      <div className="w-20 h-20 bg-[#dcfce7] rounded-full flex items-center justify-center">
        <Check size={38} className="text-[#15803d]"/>
      </div>
      <h3 className="text-xl font-bold text-gray-900">Spot Submitted!</h3>
      <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
        Your spot will appear after a quick community review. Thanks for helping Belfast drivers!
      </p>
      <div className="bg-gradient-to-r from-[#1a2332] to-[#243447] text-white px-6 py-4 rounded-2xl text-sm font-bold w-full text-center">
        🏆 +1 month Premium unlocked
      </div>
      <button onClick={()=>{setDone(false);setForm({near:'',street:'',type:'',restriction:'',notes:''});setPreview(null);}}
        className="text-[#4a9eff] text-sm font-medium underline">Submit another spot</button>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="bg-gradient-to-r from-[#4a9eff] to-purple-500 text-white p-4 rounded-2xl">
        <p className="font-bold mb-0.5">Earn Free Premium, {user.name.split(' ')[0]}</p>
        <p className="text-sm opacity-90 leading-relaxed">
          Add a verified spot the community doesn't know about — get 1 month of Premium free.
        </p>
      </div>
      <form onSubmit={e=>{e.preventDefault();setDone(true);onSpotAdded();}} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Photo</label>
          <button type="button" onClick={()=>fileRef.current.click()}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl p-5 flex flex-col items-center gap-2 text-gray-400 hover:border-[#4a9eff] hover:text-[#4a9eff] transition">
            {preview
              ? <img src={preview} alt="preview" className="w-full h-32 object-cover rounded-lg"/>
              : <><Camera size={26}/><span className="text-sm">Tap to upload a photo</span></>}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e=>{const f=e.target.files[0];if(f)setPreview(URL.createObjectURL(f));}}/>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">What's near this spot? *</label>
          <input required value={form.near} onChange={e=>set('near',e.target.value)}
            placeholder="e.g. Gransha Grill, Cave Hill, Felons Club"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff]"/>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Street or area *</label>
          <input required value={form.street} onChange={e=>set('street',e.target.value)}
            placeholder="e.g. Nansen Street, off Glen Road"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff]"/>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Spot type *</label>
          <div className="flex flex-wrap gap-2">
            {SPOT_TYPES.map(t=>(
              <button type="button" key={t} onClick={()=>set('type',t)}
                className={`text-xs px-3 py-2 rounded-full border-2 font-medium transition ${
                  form.type===t?'border-[#4a9eff] bg-[#eef5ff] text-[#4a9eff]':'border-gray-200 text-gray-600'
                }`}>{t}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Restrictions *</label>
          <div className="flex flex-wrap gap-2">
            {RESTRICTIONS.map(r=>(
              <button type="button" key={r} onClick={()=>set('restriction',r)}
                className={`text-xs px-3 py-2 rounded-full border-2 font-medium transition ${
                  form.restriction===r?'border-[#22c55e] bg-[#dcfce7] text-[#15803d]':'border-gray-200 text-gray-600'
                }`}>{r}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Local knowledge (optional)</label>
          <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={3}
            placeholder="Tell locals what to expect — restrictions, best times, how many cars fit…"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] resize-none"/>
        </div>
        <button type="submit"
          className="w-full bg-[#1a2332] text-white py-4 rounded-xl font-bold text-base hover:bg-[#243447] transition flex items-center justify-center gap-2 shadow-md">
          <Plus size={20}/>Submit Parking Spot
        </button>
      </form>
    </div>
  );
};

// ── Main App ──────────────────────────────────────────────────────────────────
const TABS = [
  { id:'search',     label:'Search',     Icon:Search    },
  { id:'nearby',     label:'Nearby',     Icon:Crosshair },
  { id:'businesses', label:'Businesses', Icon:Building2 },
  { id:'saved',      label:'Saved',      Icon:Bookmark  },
  { id:'add',        label:'Add Spot',   Icon:Plus      },
];

export default function App() {
  const [tab, setTab] = useState('search');
  const [user, setUser]       = useState(()=>ls.get('pe_user', null));
  const [saved, setSaved]     = useState(()=>new Set(ls.get('pe_saved',[])));
  const [ratings, setRatings] = useState(()=>ls.get('pe_ratings',{}));
  const [recentSearches, setRecentSearches] = useState(()=>ls.get('pe_recent',[]));
  const [showWelcome, setShowWelcome] = useState(()=>!ls.get('pe_user',null) && !ls.get('pe_skipped',false));
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showBizModal, setShowBizModal] = useState(false);
  const [isPremium, setIsPremium] = useState(()=>ls.get('pe_premium', false));
  const [showPricing, setShowPricing] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('premium') === 'success') {
      setIsPremium(true);
      ls.set('pe_premium', true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleJoin = (userData) => {
    setUser(userData);
    ls.set('pe_user', userData);
    setShowWelcome(false);
  };

  const handleSkip = () => {
    ls.set('pe_skipped', true);
    setShowWelcome(false);
  };

  const handleSignOut = () => {
    setUser(null);
    ls.set('pe_user', null);
    ls.set('pe_skipped', false);
    setShowUserMenu(false);
    setShowWelcome(true);
  };

  const toggleSave = (id) => {
    setSaved(prev=>{
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      ls.set('pe_saved',[...next]);
      return next;
    });
  };

  const rateSpot = (id, val) => {
    setRatings(prev=>{
      const next={...prev};
      next[id]===val ? delete next[id] : (next[id]=val);
      ls.set('pe_ratings',next);
      return next;
    });
  };

  const addRecentSearch = (q) => {
    if (!q.trim()) return;
    setRecentSearches(prev=>{
      const next=[q,...prev.filter(r=>r!==q)].slice(0,5);
      ls.set('pe_recent',next);
      return next;
    });
  };

  const handleSpotAdded = () => {
    if (!user) return;
    const updated = {...user, spotsAdded:(user.spotsAdded||0)+1};
    setUser(updated);
    ls.set('pe_user', updated);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{maxWidth:680,margin:'0 auto'}}>
      {/* Modals */}
      {showWelcome && <WelcomeModal onJoin={handleJoin} onSkip={handleSkip}/>}
      {showBizModal && <BusinessModal onClose={()=>setShowBizModal(false)}/>}
      {showPricing && <PricingModal isPremium={isPremium} onClose={()=>setShowPricing(false)}/>}
      {showUserMenu && (
        <UserMenu
          user={user}
          spotsAdded={user?.spotsAdded||0}
          isPremium={isPremium}
          onSignOut={handleSignOut}
          onUpgrade={()=>{setShowUserMenu(false);setShowPricing(true);}}
          onClose={()=>setShowUserMenu(false)}
        />
      )}

      {/* Header */}
      <header style={{background:'#1a2332'}} className="sticky top-0 z-50 shadow-lg">
        <div className="px-4 pt-4 pb-0">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-9 h-9 bg-[#4a9eff] rounded-lg flex items-center justify-center flex-shrink-0">
              <MapPin size={20} className="text-white"/>
            </div>
            <div>
              <h1 className="text-white font-extrabold text-base leading-tight tracking-tight">
                ParkEasy — Belfast
              </h1>
              <p className="text-blue-300 text-xs">Where locals actually park</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <a href="https://github.com/MartySpanish/parkeasy-mobile" target="_blank" rel="noreferrer"
                className="text-blue-300 hover:text-white transition opacity-60 hover:opacity-100 p-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
              </a>
              {user ? (
                <button onClick={()=>setShowUserMenu(v=>!v)}
                  className="relative w-8 h-8 bg-[#4a9eff] rounded-full flex items-center justify-center text-white font-bold text-xs hover:bg-blue-400 transition">
                  {user.name.charAt(0).toUpperCase()}
                  {isPremium && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-yellow-400 rounded-full flex items-center justify-center text-yellow-900 font-black" style={{fontSize:7}}>★</span>
                  )}
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button onClick={()=>setShowPricing(true)}
                    className="text-xs bg-yellow-400 text-yellow-900 px-2.5 py-1.5 rounded-full font-bold hover:bg-yellow-300 transition">
                    ★ PRO
                  </button>
                  <button onClick={()=>setShowWelcome(true)}
                    className="text-xs bg-[#4a9eff] text-white px-3 py-1.5 rounded-full font-semibold hover:bg-blue-400 transition">
                    Sign in
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-white border-opacity-10">
            {TABS.map(({id,label,Icon})=>{
              const active = tab===id;
              const pill = id==='saved' && saved.size>0 ? saved.size : null;
              return (
                <button key={id} onClick={()=>setTab(id)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold border-b-2 transition ${
                    active ? 'text-[#4a9eff] border-[#4a9eff]' : 'text-blue-300 border-transparent hover:text-white'
                  }`}>
                  <div className="relative">
                    <Icon size={17}/>
                    {pill && (
                      <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] bg-[#4a9eff] text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                        {pill}
                      </span>
                    )}
                  </div>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto pb-8">
        {tab==='search'     && <SearchTab saved={saved} onSave={toggleSave} ratings={ratings} onRate={rateSpot} recentSearches={recentSearches} onSearch={addRecentSearch}/>}
        {tab==='nearby'     && <NearbyTab saved={saved} onSave={toggleSave} ratings={ratings} onRate={rateSpot}/>}
        {tab==='businesses' && <BusinessesTab onGetListed={()=>setShowBizModal(true)}/>}
        {tab==='saved'      && <SavedTab saved={saved} onSave={toggleSave} ratings={ratings} onRate={rateSpot}/>}
        {tab==='add'        && <AddSpotTab user={user} onJoinPrompt={()=>setShowWelcome(true)} onSpotAdded={handleSpotAdded}/>}
      </main>
    </div>
  );
}
