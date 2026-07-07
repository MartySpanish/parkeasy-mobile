import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapPin, Search, Crosshair, Plus, Building2, Navigation,
  Bookmark, Camera, Check, X, ChevronRight, Share2,
  Map, Star, Clock, Car, Info, LogOut, User, Filter, Smartphone, Download,
  Zap, Timer, Globe, Receipt, Key, Shield, Mail, Megaphone, FileText, Sun, Moon,
} from 'lucide-react';
import { supabase, isSupabaseEnabled, sessionToUser } from './supabase';
import { EXTRA_SPOTS } from './extraSpots';
import { EV_SPOTS } from './evSpots';
import { suggestPlaces, resolvePlace, geocodeText } from './geo';
import { notify, apiFetch } from './notify';

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
  official:   mkPin('#3b82f6', 'P'),
};

const BADGES = {
  free:       { label: 'FREE',          bg: '#dcfce7', fg: '#15803d', dot: '#22c55e' },
  hidden_gem: { label: '💎 Hidden Gem', bg: '#f3e8ff', fg: '#7e22ce', dot: '#a855f7' },
  timed:      { label: '⏱ Timed',       bg: '#fff7ed', fg: '#9a3412', dot: '#f59e0b' },
  paid:       { label: 'Pay & Display', bg: '#fef9c3', fg: '#92400e', dot: '#eab308' },
  official:   { label: '🅿 Official',    bg: '#dbeafe', fg: '#1e3a5f', dot: '#3b82f6' },
};

// Kerb-marking style indicators — left edge of each SpotCard mimics real kerb paint.
const KERB = {
  free:       { color: '#22c55e', style: 'solid',  width: 4 },
  hidden_gem: { color: '#a855f7', style: 'double', width: 6 },
  timed:      { color: '#f59e0b', style: 'dashed', width: 4 },
  paid:       { color: '#eab308', style: 'dashed', width: 4 },
  official:   { color: '#3b82f6', style: 'solid',  width: 4 },
};

// Badge-themed gradients for the card header when a spot has no real photo —
// looks intentional and premium instead of relying on a flaky static-map image.
const CARD_THEME = {
  free:       { grad: 'linear-gradient(135deg,#34d399 0%,#059669 100%)' },
  hidden_gem: { grad: 'linear-gradient(135deg,#c084fc 0%,#7c3aed 100%)' },
  timed:      { grad: 'linear-gradient(135deg,#fbbf24 0%,#d97706 100%)' },
  paid:       { grad: 'linear-gradient(135deg,#fcd34d 0%,#ca8a04 100%)' },
  official:   { grad: 'linear-gradient(135deg,#60a5fa 0%,#2563eb 100%)' },
};

const BELFAST_CENTER = [54.5973, -5.9301];

// ── Notification email (Resend via /api/notify → CONTACT_EMAIL) ───────────────
const notifyAdmin = (name, email) => notify('signup', { name, email });

// ── Stripe links ──────────────────────────────────────────────────────────────
const STRIPE_MONTHLY = 'https://buy.stripe.com/00w4gscgJ6QoahjcTU0kE01';
const STRIPE_ANNUAL  = 'https://buy.stripe.com/5kQ6oA1C5eiQ0GJg660kE00';

// ── Free / VIP Premium access ───────────────────────────────────────────────
// Accounts that sign in with one of these emails are always Premium, on any
// device — no Stripe checkout needed. Add more emails here as needed.
const VIP_EMAILS = ['martinrooney3@hotmail.com'];
// Master accounts that can open the in-app analytics dashboard.
const ADMIN_EMAILS = ['martinrooney3@hotmail.com', 'parkeasyuk@gmail.com'];
const isAdminUser = (u) => !!u?.email && ADMIN_EMAILS.includes(u.email.toLowerCase());
// Shared invite code you can hand out to influencers etc. for free Premium.
// This lives in the client bundle, so treat it as a "thank you" perk rather
// than a secure paywall — anyone determined could find it in the page source.
const VIP_CODE = 'PARKEASY-VIP';

// ── Seed data ─────────────────────────────────────────────────────────────────
const SPOTS = [
  { id:1,  name:'Directly outside — Gransha Grill',   near:'Gransha Grill',    tags:['gransha grill','gransha road','turf lodge','gransha park'],                                          badge:'free',       dist:0.00, walk:'Right outside', restriction:'No restrictions',              notes:'Park right outside the door — 2–3 cars fit easily. Free all day, no signage spotted.', lat:54.5901, lng:-5.9942, by:'GranshaLocal',        votes:61, photo:null, price:null,      spaces:3    },
  { id:2,  name:'Gransha Road Lay-by (north side)',    near:'Gransha Grill',    tags:['gransha grill','gransha road','turf lodge','gransha park'],                                          badge:'free',       dist:0.04, walk:'1 min',          restriction:'Free all day',                 notes:'Wider lay-by fits 4+ cars, 1 min walk back. Locals use this daily — never seen a warden.', lat:54.5908, lng:-5.9950, by:'RegularDiner',        votes:44, photo:null, price:null,      spaces:5    },
  { id:3,  name:'Side road off Gransha Road',          near:'Gransha Grill',    tags:['gransha grill','gransha','turf lodge','gransha park'],                                              badge:'hidden_gem', dist:0.07, walk:'2 min',          restriction:'Evenings & weekends fine',     notes:'Quiet residential street, no wardens ever spotted. Walk right back to the Grill.', lat:54.5896, lng:-5.9928, by:'ParkingPro_BT',      votes:29, photo:null,                                                                                          price:null,      spaces:8    },
  { id:4,  name:'Trailhead gravel area',               near:'Black Mountain',   tags:['black mountain','black mountain walk','hiking'],                        badge:'free',       dist:0.00, walk:'Trail start',    restriction:'Free all day',                 notes:"Gets busy weekends — arrive before 10am or you'll be circling. Gravel surface, 15–20 cars.", lat:54.6198, lng:-6.0225, by:'HikerBelfast',       votes:88, photo:null, price:null,      spaces:20   },
  { id:5,  name:'Hannahstown Hill roadside verge',     near:'Black Mountain',   tags:['black mountain','black mountain walk','hannahstown'],                   badge:'hidden_gem', dist:0.25, walk:'~5 min',         restriction:'No restrictions',              notes:'Wide verge fits 6+ easily. Better than the main area on busy days — most tourists miss it.', lat:54.6175, lng:-6.0190, by:'DogWalkerDermot',   votes:52, photo:null, price:null,      spaces:7    },
  { id:6,  name:'Whiterock Road lay-by',               near:'Black Mountain',   tags:['black mountain','black mountain walk','whiterock'],                     badge:'free',       dist:0.38, walk:'~8 min',         restriction:'Free all day',                 notes:'Alternative start point, less crowded. Walk up through Whiterock — great views on the way.', lat:54.6150, lng:-6.0150, by:'Springfield_Regular',votes:31, photo:null,                                                                                          price:null,      spaces:6    },
  { id:7,  name:'Glen Road on-street (outside)',       near:'Glen Road barber', tags:['glen road barber','tommy barber','glen road'],                          badge:'timed',      dist:0.00, walk:'Outside',        restriction:'Mon–Sat 9am–5pm timed',        notes:'Check yellow lines carefully. Usually fine evenings and Sundays — quick in-and-out for a cut.', lat:54.5935, lng:-6.0012, by:'GlenRoadRegular',    votes:55, photo:null, price:null,      spaces:4    },
  { id:8,  name:'Bingnian Drive',                      near:'Glen Road barber', tags:['glen road barber','tommy barber','bingnian'],                           badge:'free',       dist:0.05, walk:'~2 min',         restriction:'Free, unrestricted',           notes:'Quiet side street, 2 min walk to the barber. Community confirmed no restrictions.', lat:54.5940, lng:-6.0025, by:'NansenNeighbour',    votes:38, photo:null,                                                                                          price:null,      spaces:10   },
  { id:9,  name:'Falls Road on-street',                near:'Falls Road',       tags:['falls road','west belfast fitness','felons','roma pizza','andersonstown'],badge:'paid',      dist:0.00, walk:'On the road',    restriction:'Mon–Sat 9am–6pm Pay & Display',notes:'Free evenings and Sundays. Pay & Display machine on the road. £1/hr during restricted hours.', lat:54.5965, lng:-5.9720, by:'FallsRoadFred', votes:73, photo:null, price:'£1.00/hr', spaces:null },
  { id:10, name:'Dunlewey Street',                     near:'Falls Road',       tags:['falls road','west belfast fitness'],                                    badge:'free',       dist:0.06, walk:'~2 min',         restriction:'Unrestricted',                 notes:'Community confirmed no restrictions on this quiet side street. Always a space here.', lat:54.5970, lng:-5.9740, by:'ClowneyLocal',       votes:47, photo:null,                                                                                          price:null,      spaces:12   },
  { id:11, name:'International Wall lay-by',           near:'Falls Road',       tags:['falls road','murals','international wall'],                             badge:'hidden_gem', dist:0.09, walk:'~3 min',         restriction:'Free, no restrictions',        notes:'Handy for quick visits beside the murals. Hidden gem — rarely full even on tourist days.', lat:54.5975, lng:-5.9695, by:'DivisDweller',       votes:33, photo:null, price:null,      spaces:6    },
  { id:12, name:'Belfast Castle car park',             near:'Cave Hill',        tags:['cave hill','belfast castle','napoleons nose'],                          badge:'free',       dist:0.00, walk:'1 min',          restriction:'Free all day',                 notes:"Fills up on sunny weekends — arrive before noon. Official free car park, well maintained.", lat:54.6375, lng:-5.9605, by:'CaveHillClimber',    votes:97, photo:null, price:null,      spaces:80   },
  { id:13, name:'Innisfayle Park overflow',            near:'Cave Hill',        tags:['cave hill','innisfayle','antrim road'],                                 badge:'hidden_gem', dist:0.19, walk:'~7 min',         restriction:'Residential — be respectful',  notes:'When the castle car park is rammed, locals use this quiet road. Always space. Short walk up.', lat:54.6350, lng:-5.9580, by:'AntrimRoadAndy',     votes:51, photo:null,                                                                                          price:null,      spaces:null },
  { id:14, name:'Boucher Road area streets',           near:'Balmoral Show',    tags:['balmoral show','boucher road','kings hall'],                            badge:'free',       dist:0.35, walk:'~8 min',         restriction:'Show days — community use',    notes:'Community park in surrounding streets and walk. Saves a fortune vs official show parking.', lat:54.5710, lng:-5.9420, by:'ShowGoer',           votes:66, photo:null, price:null,      spaces:null },
  { id:15, name:'Tates Avenue',                        near:'Balmoral Show',    tags:['balmoral show','tates avenue'],                                         badge:'free',       dist:0.90, walk:'~15 min',        restriction:'No restrictions',              notes:'15 min walk saves the show parking charges entirely. Well used on show days.', lat:54.5720, lng:-5.9370, by:'BalmoralBargain',     votes:44, photo:null,                                                                                          price:null,      spaces:null },
  { id:16, name:'NCP Victoria Square',                 near:'Victoria Square',  tags:['city centre','victoria square','ncp','belfast city centre'],            badge:'official',   dist:0.10, walk:'2 min',          restriction:'Open 24/7',                    notes:'NCP multi-storey. 547 spaces. Right beside Victoria Square mall. (Separate from Q-Park inside the shopping centre.)', lat:54.5973, lng:-5.9260, by:'NCP Belfast',         votes:0,  photo:null, price:'£2.00/hr', spaces:547, available:330, total:547 },
  { id:17, name:'NCP Montgomery Street',               near:'Cathedral Quarter',tags:['cathedral quarter','montgomery street','ncp','city centre'],             badge:'official',   dist:0.20, walk:'4 min',          restriction:'Open 24/7',                    notes:'NCP multi-storey on Montgomery Street. 447 spaces. Great for Cathedral Quarter bars and restaurants.', lat:54.5998, lng:-5.9270, by:'NCP Belfast',         votes:0,  photo:null,                                                                                          price:'£1.80/hr', spaces:447, available:270, total:447 },
  { id:18, name:'Q-Park Obel',                         near:'Titanic Quarter',  tags:['titanic quarter','obel','qpark','donegall quay','titanic'],             badge:'official',   dist:0.15, walk:'3 min',          restriction:'Open 24/7',                    notes:'Q-Park at the Obel tower, Donegall Quay. 267 spaces across 2 basement levels. Best option for Titanic Quarter visits.', lat:54.6008, lng:-5.9245, by:'Q-Park Belfast',      votes:0,  photo:null,                                                                                          price:'£2.50/hr', spaces:267, available:160, total:267 },
  { id:19, name:'Q-Park Victoria Square',              near:'Victoria Square',  tags:['victoria square','qpark','city centre'],                                badge:'official',   dist:0.05, walk:'1 min',          restriction:'Open 24/7',                    notes:'Q-Park inside Victoria Square shopping centre — 1,000 spaces across 2 basement levels. Validated parking available with some stores.', lat:54.5975, lng:-5.9255, by:'Q-Park Belfast',      votes:0,  photo:null,                                                                                          price:'£2.20/hr', spaces:1000, available:600, total:1000 },
  { id:20, name:'BCC Bankmore Square',                 near:'City Centre',      tags:['city centre','bankmore','belfast city council'],                        badge:'official',   dist:0.30, walk:'6 min',          restriction:'Mon–Sat 8am–6pm',              notes:'Belfast City Council surface car park — 46 bays. Small but convenient and good rates. Short walk to City Hall.', lat:54.5940, lng:-5.9300, by:'Belfast City Council',votes:0,  photo:null,                                                                                          price:'£1.50/hr', spaces:46, available:28, total:46 },
  { id:21, name:'Castle Street Multi-Storey',          near:'Castle Court',     tags:['castle court','castle street','royal avenue','city centre'],            badge:'official',   dist:0.10, walk:'2 min',          restriction:'Open 24/7',                    notes:'Multi-storey at 1 Francis Street — 610 spaces, 34 disabled bays. Perfect for Castle Court and Royal Avenue shopping.', lat:54.5985, lng:-5.9335, by:'Castle Street CP',    votes:0,  photo:null,                                                                                          price:'£1.60/hr', spaces:610, available:366, total:610 },
  { id:22, name:'BCC Tomb Street',                     near:"St George's Market",tags:['city centre','tomb street','belfast city council',"st george's market",'markets'],badge:'official',dist:0.20,walk:'4 min',restriction:'Mon–Sat 8am–6pm',notes:"Belfast City Council car park — 198 spaces. Good for St George's Market and Cathedral Quarter. Free after 6pm weekdays.", lat:54.6002, lng:-5.9280, by:'Belfast City Council',votes:0,  photo:null,                                                                                          price:'£1.40/hr', spaces:198, available:120, total:198 },
  { id:23, name:'Exchange Street on-street',           near:'Cathedral Quarter',tags:['cathedral quarter','exchange street','custom house square'],            badge:'timed',      dist:0.05, walk:'2 min',          restriction:'Mon–Sat 8am–6pm',              notes:'On-street right in the Cathedral Quarter. Free evenings and Sundays — ideal for a night out.', lat:54.6012, lng:-5.9268, by:'CQ_Regular',         votes:42, photo:null, price:null, spaces:null },
  { id:24, name:'Waring Street hidden lay-by',         near:'Cathedral Quarter',tags:['cathedral quarter','waring street','custom house square'],              badge:'hidden_gem', dist:0.08, walk:'3 min',          restriction:'Evenings & weekends free',     notes:'Small lay-by most people miss — tucked just off Waring Street. Cathedral Quarter regulars swear by it.', lat:54.6010, lng:-5.9275, by:'CQ_Insider',         votes:38, photo:null, price:null, spaces:4 },
  { id:25, name:'Queens Road on-street',               near:'Titanic Quarter',  tags:['titanic quarter','titanic belfast','queens road','titanic','ss nomadic'],badge:'free',      dist:0.10, walk:'3 min',          restriction:'Free all day',                 notes:'Long stretch of free on-street parking on Queens Road. Easy walk to Titanic Belfast and SS Nomadic.', lat:54.6077, lng:-5.9100, by:'TitanicVisitor',      votes:67, photo:null, price:null, spaces:null },
  { id:26, name:'University Road on-street',           near:'Botanic Gardens',  tags:['botanic gardens','botanic','queens university','university road','botanic avenue'],badge:'timed',dist:0.10,walk:'3 min',restriction:'Mon–Sat 8am–6pm',notes:'On-street along University Road. Free after 6pm and all day Sundays — best for Botanic Gardens.', lat:54.5840, lng:-5.9330, by:'QUB_Student',         votes:53, photo:null, price:null, spaces:null },
  { id:27, name:'Botanic Avenue side streets',         near:'Botanic Gardens',  tags:['botanic gardens','botanic avenue','botanic','queens university'],       badge:'hidden_gem', dist:0.15, walk:'4 min',          restriction:'Evenings & weekends free',     notes:'Quiet residential streets off Botanic Avenue. Locals park here instead of paying nearby car parks.', lat:54.5835, lng:-5.9345, by:'BotanicLocal',        votes:44, photo:null, price:null, spaces:null },
  { id:28, name:'Millfield on-street',                 near:'Castle Court',     tags:['castle court','millfield','royal avenue','castle court belfast'],       badge:'free',       dist:0.20, walk:'5 min',          restriction:'Free evenings & weekends',     notes:'Free on-street just north of Castle Court. Walk down through Royal Avenue to the shops.', lat:54.6002, lng:-5.9362, by:'ShopperLocal',       votes:35, photo:null, price:null, spaces:null },
  { id:29, name:'East Bridge Street on-street',        near:"St George's Market",tags:["st george's market","east bridge street","george's market","markets"], badge:'timed',      dist:0.10, walk:'3 min',          restriction:'Mon–Sat 8am–6pm',              notes:'Handy for the Friday and Saturday market. Free Sunday mornings — perfect timing for a market visit.', lat:54.5950, lng:-5.9215, by:'MarketGoer',         votes:41, photo:null, price:null, spaces:null },
  { id:30, name:'May Street on-street',                near:"St George's Market",tags:["st george's market","may street","george's market","markets"],         badge:'hidden_gem', dist:0.12, walk:'3 min',          restriction:'Free Sunday mornings',         notes:'Great for Sunday market visits — usually spaces even on busy market days. 3 min flat walk to the entrance.', lat:54.5945, lng:-5.9230, by:'SundayMarket',        votes:29, photo:null, price:null, spaces:null },
  { id:31, name:'Ann Street on-street',                near:'Victoria Square',  tags:['victoria square','ann street','victoria square belfast','city centre'], badge:'timed',      dist:0.08, walk:'2 min',          restriction:'Mon–Sat 8am–6pm',              notes:'On-street right beside Victoria Square. Free after 6pm — perfect for evening shopping or dinner.', lat:54.5968, lng:-5.9248, by:'VicSquareLocal',     votes:38, photo:null, price:null, spaces:null },
  // ── Extra spots sourced from OpenStreetMap (overpass.openstreetmap.org) ──
  { id:32, name:'Great Victoria Street on-street',    near:'Grand Opera House', tags:['grand opera house','great victoria street','europa hotel','crown bar','city centre'], badge:'timed', dist:0.00, walk:'Right there', restriction:'Mon–Sat 8am–6pm', notes:'On-street along Great Victoria Street. Free evenings and Sundays — ideal before a show at the Opera House or visiting the Crown Bar.', lat:54.5950, lng:-5.9338, by:'OperaLocal',       votes:48, photo:null, price:'£1.20/hr', spaces:null },
  { id:33, name:'Dublin Road on-street',               near:'Shaftesbury Square',tags:['shaftesbury square','dublin road','city centre','restaurants','golden mile'],       badge:'timed', dist:0.00, walk:'Right there', restriction:'Mon–Sat 8am–6pm', notes:'On Dublin Road near Shaftesbury Square. Free after 6pm — locals park here for the Golden Mile restaurants and bars.', lat:54.5922, lng:-5.9330, by:'DublinRdLocal',    votes:37, photo:null, price:'£1.20/hr', spaces:null },
  { id:34, name:'Cromac Street on-street',             near:"St George's Market",tags:["st george's market",'cromac street','markets','city centre'],                       badge:'timed', dist:0.12, walk:'3 min',      restriction:'Mon–Sat 8am–6pm', notes:'Good alternative to May Street for market visits. Quieter road — often spaces when elsewhere is full. Free evenings.', lat:54.5952, lng:-5.9218, by:'MarketLocal',      votes:31, photo:null, price:null,      spaces:null },
  { id:35, name:'Ormeau Road on-street',               near:'Ormeau Road',       tags:['ormeau road','south belfast','ormeau','ormeau bakehouse'],                          badge:'free',  dist:0.00, walk:'On the road', restriction:'Free — no restrictions',   notes:'Long stretch of free parking on Ormeau Road. Great for Ormeau Bakehouse, bars and restaurants along the strip.', lat:54.5870, lng:-5.9250, by:'OrmeauLocal',      votes:44, photo:null, price:null,      spaces:null },
  { id:36, name:'Ormeau Embankment riverside',         near:'Ormeau Road',       tags:['ormeau embankment','lagan','riverside','ormeau','south belfast','free parking'],    badge:'hidden_gem', dist:0.20, walk:'5 min', restriction:'Free all day', notes:'Completely free riverside parking off Ormeau Embankment. Walk along the Lagan towpath to the Gasworks or city centre. Locals keep this quiet!', lat:54.5882, lng:-5.9185, by:'LagansideLad', votes:67, photo:null, price:null, spaces:null, premium:true },
  { id:37, name:'Lisburn Road side streets',           near:'Lisburn Road',      tags:['lisburn road','south belfast','balmoral','lisburn road shops'],                     badge:'free',  dist:0.15, walk:'3–5 min',    restriction:'Residential — free',       notes:'Side streets off Lisburn Road are free and unrestricted. Walk back to the cafés and boutiques. Avoid double-yellows on the main road.', lat:54.5790, lng:-5.9430, by:'LisburnShopper', votes:52, photo:null, price:null, spaces:null },
  { id:38, name:'Stranmillis Road on-street',          near:'Stranmillis',       tags:['stranmillis','botanic gardens','queens university','stranmillis road','south belfast'],badge:'timed', dist:0.00, walk:'On the road', restriction:'Mon–Sat 9am–6pm', notes:'On-street on Stranmillis Road — free evenings and Sundays. Good for QUB, Botanic Gardens and Stranmillis village cafés.', lat:54.5812, lng:-5.9370, by:'QUBLocal',        votes:33, photo:null, price:null, spaces:null },
  { id:39, name:'Wellington Place on-street',          near:'City Hall',         tags:['city hall','wellington place','donegall square','city centre'],                     badge:'timed', dist:0.05, walk:'2 min',      restriction:'Mon–Sat 8am–6pm', notes:'On-street right beside City Hall and Donegall Square. Free evenings — great for the Christmas market and city centre events.', lat:54.5968, lng:-5.9335, by:'CityHallLocal', votes:41, photo:null, price:'£2.00/hr', spaces:null },
  { id:40, name:'Bedford Street on-street',            near:'Waterfront Hall',   tags:['waterfront hall','bedford street','ulster hall','city centre'],                     badge:'timed', dist:0.10, walk:'3 min',      restriction:'Mon–Sat 8am–6pm', notes:'On-street near Waterfront Hall and Ulster Hall. Free evenings — perfect for concerts and events. Usually spaces even on event nights.', lat:54.5955, lng:-5.9295, by:'WaterfrontLocal', votes:38, photo:null, price:'£1.60/hr', spaces:null },
  { id:41, name:'York Street on-street',               near:'Titanic Quarter',   tags:['titanic quarter','york street','sailortown','north belfast','titanic'],             badge:'free',  dist:0.80, walk:'~15 min',    restriction:'Free — no restrictions',   notes:'Long free stretch on York Street and surrounding roads. Locals use this as a free base for Titanic Belfast — longer walk but saves the car park fee entirely.', lat:54.6045, lng:-5.9290, by:'TitanicWalker', votes:39, photo:null, price:null, spaces:null },
  { id:42, name:'Holywood Arches on-street',           near:'East Belfast',      tags:['holywood arches','east belfast','upper newtownards road'],                          badge:'free',  dist:0.00, walk:'On the road', restriction:'Free — no restrictions',   notes:'Plenty of on-street parking around Holywood Arches. Easy access to East Belfast shops, bars and restaurants on Upper Newtownards Road.', lat:54.5960, lng:-5.8875, by:'EastBelfastLocal', votes:29, photo:null, price:null, spaces:null },
  { id:43, name:'Connswater retail park',              near:'Connswater',        tags:['connswater','east belfast','retail park','connswater centre'],                       badge:'free',  dist:0.00, walk:'Right there', restriction:'Retail hours only',         notes:'Free retail park at Connswater. Huge car park — always spaces. Use as a base for East Belfast or take the Glider to the city centre.', lat:54.5878, lng:-5.8848, by:'ConnsLocal',       votes:55, photo:null, price:null, spaces:500  },
  { id:44, name:'Upper Queen Street on-street',        near:'City Hall',         tags:['city centre','upper queen street','city hall','belfast city centre'],               badge:'timed', dist:0.10, walk:'3 min',      restriction:'Mon–Sat 8am–6pm', notes:'Quiet on-street beside the courts and civic buildings. Often missed by shoppers — right beside City Hall. Free after 6pm.', lat:54.5978, lng:-5.9318, by:'QueenStLocal',   votes:27, photo:null, price:'£1.60/hr', spaces:null },
  { id:45, name:'Ormeau Avenue on-street',             near:'City Centre',       tags:['ormeau avenue','bbc','google','city centre','gasworks'],                             badge:'timed', dist:0.00, walk:'Right there', restriction:'Mon–Fri 8am–6pm', notes:'On-street near BBC NI and Ormeau Baths Gallery. Free weekends — great for gallery visits and Ormeau events.', lat:54.5917, lng:-5.9245, by:'OrmAvLocal',      votes:34, photo:null, price:'£1.20/hr', spaces:null },
  { id:46, name:'Hamilton Dock overflow',              near:'Titanic Quarter',   tags:['titanic quarter','hamilton dock','ss nomadic','titanic belfast','titanic'],         badge:'hidden_gem', dist:0.20, walk:'5 min', restriction:'Free all day', notes:'Overflow area near Hamilton Dock — free and often has spaces when Queens Road fills up on peak days. Easy walk to Titanic Belfast and SS Nomadic.', lat:54.6068, lng:-5.9152, by:'TitanicLocal', votes:43, photo:null, price:null, spaces:null },
  { id:47, name:'Ravenhill Road on-street',            near:'East Belfast',      tags:['ravenhill','east belfast','kingspan stadium','ulster rugby','ravenhill road'],      badge:'free',  dist:0.00, walk:'On the road', restriction:'Free — no restrictions',   notes:'Long stretch of free on-street on Ravenhill Road. Popular with Ulster Rugby fans on match days. Easy access to Ormeau Park.', lat:54.5898, lng:-5.8972, by:'RavenhillLocal', votes:31, photo:null, price:null, spaces:null },
  { id:48, name:'Lanyon Place on-street',              near:'Waterfront Hall',   tags:['waterfront hall','lanyon place','city centre','belfast city centre'],               badge:'timed',      dist:0.05, walk:'2 min',          restriction:'Mon–Sat 8am–6pm',              notes:'On-street at Lanyon Place. Free evenings — excellent for Waterfront and Ulster Hall events. Often overlooked by visitors.', lat:54.5960, lng:-5.9265, by:'WaterfrontGoer', votes:29, photo:null, price:'£1.60/hr', spaces:null, ev:{available:true,ports:2,speed:'7kW'} },
  { id:49, name:'Grosvenor Road multi-storey',         near:'Royal Victoria Hospital', tags:['royal victoria','grosvenor road','west belfast','multi-storey'],               badge:'official',   dist:0.05, walk:'2 min',          restriction:'Open 24/7',                    notes:'Multi-storey beside the Royal Victoria Hospital. 24/7 access, good for Falls Road and Grosvenor Road.', lat:54.5960, lng:-5.9540, by:'Official', votes:0, photo:null, price:'£1.80/hr', spaces:300, available:180, total:300 },
  { id:50, name:'Park & Ride — Cairnshill',            near:'South Belfast',     tags:['park and ride','cairnshill','south belfast','park & ride'],                         badge:'official',   dist:0.00, walk:'Bus to city',    restriction:'Mon–Sat 7am–7pm',              notes:'Official Translink Park & Ride — 725 spaces, 12 accessible bays. Regular Metro bus to city centre. Free parking — just pay the bus fare.', lat:54.5542, lng:-5.9255, by:'Translink', votes:0, photo:null, price:null, spaces:725, available:435, total:725, ev:{available:true,ports:2,speed:'7kW'} },
  { id:51, name:'Park & Ride — Dundonald',             near:'East Belfast',      tags:['park and ride','dundonald','east belfast','park & ride'],                           badge:'official',   dist:0.00, walk:'Bus to city',    restriction:'Mon–Sat 7am–7pm',              notes:'Official Translink Park & Ride — 517 spaces, 8 accessible bays. Regular Metro bus to the city centre. Free parking with bus ticket — great for East Belfast commuters.', lat:54.5812, lng:-5.8390, by:'Translink', votes:0, photo:null, price:null, spaces:517, available:310, total:517, ev:{available:true,ports:2,speed:'7kW'} },
  { id:52, name:'Titanic Quarter multi-storey',        near:'Titanic Quarter',   tags:['titanic quarter','titanic belfast','multi-storey','titanic'],                       badge:'official',   dist:0.10, walk:'3 min',          restriction:'Open 7am–10pm',                notes:'Official underground car park for Titanic Belfast — 520 secure spaces. Close to Titanic Belfast, SS Nomadic and W5. Pre-booking recommended on busy days.', lat:54.6070, lng:-5.9125, by:'Titanic Belfast', votes:12, photo:null, price:'£3.00/hr', spaces:520, available:312, total:520, ev:{available:true,ports:8,speed:'22kW'} },
  { id:53, name:'Castle Court multi-storey',           near:'Castle Court',      tags:['castle court','multi-storey','city centre','royal avenue'],                         badge:'official',   dist:0.00, walk:'Right there',    restriction:'Open 7am–10pm Mon–Sat',        notes:'Multi-storey inside Castle Court shopping centre — 1,550 spaces with EV charging on level 5. Validated parking available with purchase in many stores.', lat:54.5992, lng:-5.9352, by:'CastleCourt', votes:8, photo:null, price:'£2.50/hr', spaces:1550, available:930, total:1550, ev:{available:true,ports:4,speed:'7kW'} },
  { id:54, name:'Lagan Towpath riverside (free)',      near:'Lagan Towpath',     tags:['lagan towpath','riverside','lagan','south belfast','free parking'],                 badge:'hidden_gem', dist:0.00, walk:'Riverside start', restriction:'Free all day',                notes:'Completely free parking along the Lagan towpath riverside roads. Walk or cycle along the Lagan from here. Popular with locals but rarely on parking apps.', lat:54.5810, lng:-5.9155, by:'LaganLocal', votes:58, photo:null, price:null, spaces:null, premium:false },
  // ── Parks & walks around Belfast (free car parks) ──
  { id:55, name:'Stormont Estate car park',            near:'Stormont Estate',   tags:['stormont','stormont estate','east belfast','walks','parliament buildings','free parking','dog walk'], badge:'free', dist:0.00, walk:'Trail start', restriction:'Free — open dawn to dusk', notes:'Free car park at Parliament Buildings. Walk the 4km Long Woodland Walk (orange arrows), the 2km loop or the 1.6km fitness trail. Tree-lined avenue up to Stormont — great for families and dog walkers.', lat:54.6038, lng:-5.8345, by:'StormontWalker', votes:74, photo:null, price:null, spaces:200 },
  { id:56, name:'Ormeau Park car park',                near:'Ormeau Park',       tags:['ormeau park','south belfast','east belfast','walks','free parking','oldest park','dog walk'], badge:'free', dist:0.00, walk:'Trail start', restriction:'Free all day', notes:"Belfast's oldest park (1871). Free car park by the Recreation Centre — toilets and refreshments on site. Walks through mature woodland, formal gardens and a wildflower meadow overlooking the Lagan.", lat:54.5905, lng:-5.9105, by:'OrmeauParkLocal', votes:61, photo:null, price:null, spaces:120 },
  { id:57, name:'Colin Glen Forest Park',              near:'Colin Glen',        tags:['colin glen','west belfast','forest park','walks','stewartstown road','free parking','waterfall','dog walk'], badge:'free', dist:0.00, walk:'Trail start', restriction:'Free — park hours', notes:"The green lungs of West Belfast off Stewartstown Road. Car park, toilets and café on site. Surfaced riverside paths through the Colin valley with views of Black Mountain — also home to the Gruffalo Trail and zipline.", lat:54.5680, lng:-6.0010, by:'ColinGlenLocal', votes:69, photo:null, price:null, spaces:150 },
  { id:58, name:'Lagan Meadows',                       near:'Lagan Meadows',     tags:['lagan meadows','south belfast','walks','lagan','riverside','free parking','dog walk'], badge:'hidden_gem', dist:0.00, walk:'Trail start', restriction:'Free all day', notes:'Rolling riverside meadows south of the city, hugging the River Lagan. Few amenities — just wild, quiet walking and wildlife. Locals love it. Connect onto the towpath towards Shaws Bridge.', lat:54.5650, lng:-5.9230, by:'MeadowsWalker', votes:38, photo:null, price:null, spaces:30 },
  { id:59, name:'Divis & Black Mountain (NT) upper car park', near:'Divis Mountain', tags:['divis','black mountain','belfast hills','national trust','walks','hiking','free parking','summit','dog walk'], badge:'free', dist:0.00, walk:'Trail start', restriction:'Free — dawn to dusk', notes:'National Trust upper car park at the Divis Coffee Barn. Free parking and the start of the Summit Trail (1.5mi), Ridge Trail and longer loops — the best panoramic views over Belfast and Belfast Lough. Coffee Barn on site.', lat:54.6090, lng:-6.0260, by:'DivisHiker', votes:91, photo:null, price:null, spaces:60 },
  { id:60, name:'Minnowburn car park',                 near:'Minnowburn',        tags:['minnowburn','lagan valley','south belfast','walks','national trust','free parking','terrace hill','dog walk'], badge:'hidden_gem', dist:0.00, walk:'Trail start', restriction:'Free all day', notes:'Green oasis in the Lagan Valley Regional Park. Free car park, then trails along the Lagan and through woodland and farmland. Chainsaw sculptures, a wildlife pond, and Terrace Hill views over the valley. Walk to the Giant\'s Ring nearby.', lat:54.5360, lng:-5.9410, by:'MinnowburnLocal', votes:47, photo:null, price:null, spaces:40 },
  { id:61, name:'Barnett Demesne / Malone House',      near:'Barnett Demesne',   tags:['barnett demesne','malone house','south belfast','walks','lagan valley','free parking','mary peters track','dog walk'], badge:'free', dist:0.00, walk:'Trail start', restriction:'Free — park hours', notes:'Open lawns, woodland and marsh bordered by the River Lagan. Free parking at Malone House (restaurant & café on site). Easy walks and links to the towpath and Mary Peters Track.', lat:54.5520, lng:-5.9430, by:'MaloneLocal', votes:42, photo:null, price:null, spaces:80 },
  { id:62, name:'Sir Thomas & Lady Dixon Park',        near:'Dixon Park',        tags:['dixon park','sir thomas lady dixon','rose garden','south belfast','walks','upper malone','free parking','playground','dog walk'], badge:'free', dist:0.00, walk:'Trail start', restriction:'Free all day', notes:'Entrance on Upper Malone Road with free Upper and Lower car parks. Famous rose garden, walled garden, children\'s playground and the mile-long Garden Trail. Home to Rose Week each July.', lat:54.5340, lng:-5.9620, by:'DixonParkLocal', votes:66, photo:null, price:null, spaces:120 },
  { id:63, name:'Victoria Park (East Belfast)',        near:'Victoria Park',     tags:['victoria park','east belfast','walks','free parking','lagan','airport road','dog walk','cycling'], badge:'free', dist:0.00, walk:'Trail start', restriction:'Free all day', notes:'Free car park off the Sydenham bypass. Flat lakeside loop popular with runners, cyclists and families — watch the planes land at George Best City Airport. Links to the Comber Greenway.', lat:54.6030, lng:-5.8780, by:'VicParkLocal', votes:39, photo:null, price:null, spaces:60 },
  { id:64, name:'Cave Hill Country Park (Upper Cavehill Rd)', near:'Cave Hill', tags:['cave hill','cavehill','country park','walks','hiking','napoleons nose','free parking','north belfast','dog walk'], badge:'free', dist:0.00, walk:'Trail start', restriction:'Free — dawn to dusk', notes:'Alternative free car park higher up on Upper Cavehill Road — quicker route to the summit and Napoleon\'s Nose than the castle. Stunning views over the city and lough. Less crowded on busy weekends.', lat:54.6420, lng:-5.9560, by:'CaveHillHiker', votes:54, photo:null, price:null, spaces:40 },
  { id:65, name:'Whiterock Leisure Centre car park', near:'Whiterock Road', tags:['whiterock','whiterock leisure centre','west belfast','ev charging','falls','leisure centre','free parking'], badge:'free', dist:0.00, walk:'Right there', restriction:'Free — centre hours', notes:'Free car park at Whiterock Leisure Centre with 2 EV charging points — one of the few charging spots in West Belfast. Handy for the gym, pool and Falls Park. Community estimate on charger availability.', lat:54.6002, lng:-5.9840, by:'WhiterockLocal', votes:0, photo:null, price:null, spaces:60, ev:{available:true, ports:2, speed:'7kW'}, premium:true },
  { id:66, name:'LORAG centre / Shaftesbury Rec kerbside', near:'Lower Ormeau / Gasworks', tags:['lorag','shaftesbury','lower ormeau','gasworks','south belfast','free parking','city centre walk'], badge:'hidden_gem', dist:0.30, walk:'8 min', restriction:'Free all day', notes:'Founder pick: free kerbside and community-centre parking around LORAG on the Lower Ormeau, beside the Gasworks. Park up and walk into the city centre in minutes — ideal on match and gig days.', lat:54.5900, lng:-5.9235, by:'ParkEasy', votes:0, photo:null, price:null, spaces:null, premium:true },
  { id:67, name:'Kennedy Centre car park', near:'Falls Road', tags:['kennedy centre','kennedy center','falls road','west belfast','ev charging','andersonstown','shopping centre','free parking'], badge:'free', dist:0.00, walk:'Right there', restriction:'Free — centre hours', notes:'Free customer car park at the Kennedy Centre on the Falls Road with EV charging points — a handy West Belfast charging stop while you shop. Community estimate on charger speed and availability.', lat:54.5943, lng:-5.9808, by:'WestBelfastLocal', votes:0, photo:null, price:null, spaces:400, ev:{available:true, ports:2, speed:'22kW'}, premium:true },
];

// ── Cities ───────────────────────────────────────────────────────────────────
// Belfast has full community-sourced spot data. Other towns/cities are listed so
// people can pick their area and be the first to add local spots. Each city has a
// region so the picker can group them (Northern Ireland, Scotland, …).
const CITIES = [
  { id:'belfast',       name:'Belfast',           center:[54.5973,-5.9301],   region:'Northern Ireland' },
  { id:'derry',         name:'Derry~Londonderry', center:[54.9966,-7.3086],   region:'Northern Ireland' },
  { id:'lisburn',       name:'Lisburn',           center:[54.5162,-6.0581],   region:'Northern Ireland' },
  { id:'newtownabbey',  name:'Newtownabbey',      center:[54.6800,-5.9200],   region:'Northern Ireland' },
  { id:'bangor',        name:'Bangor',            center:[54.6604,-5.6694],   region:'Northern Ireland' },
  { id:'newry',         name:'Newry',             center:[54.1751,-6.3402],   region:'Northern Ireland' },
  { id:'antrim',        name:'Antrim',            center:[54.7140,-6.2110],   region:'Northern Ireland' },
  { id:'ballymena',     name:'Ballymena',         center:[54.8644,-6.2770],   region:'Northern Ireland' },
  { id:'coleraine',     name:'Coleraine',         center:[55.1329,-6.6659],   region:'Northern Ireland' },
  { id:'portrush',      name:'Portrush',          center:[55.2072,-6.6596],   region:'Northern Ireland' },
  { id:'carrickfergus', name:'Carrickfergus',     center:[54.7164,-5.8065],   region:'Northern Ireland' },
  { id:'larne',         name:'Larne',             center:[54.8499,-5.8230],   region:'Northern Ireland' },
  { id:'enniskillen',   name:'Enniskillen',       center:[54.3447,-7.6387],   region:'Northern Ireland' },
  { id:'omagh',         name:'Omagh',             center:[54.5963,-7.2960],   region:'Northern Ireland' },
  { id:'dungannon',     name:'Dungannon',         center:[54.5033,-6.7693],   region:'Northern Ireland' },
  { id:'cookstown',     name:'Cookstown',         center:[54.6444,-6.7443],   region:'Northern Ireland' },
  { id:'strabane',      name:'Strabane',          center:[54.8271,-7.4638],   region:'Northern Ireland' },
  { id:'downpatrick',   name:'Downpatrick',       center:[54.3228,-5.7156],   region:'Northern Ireland' },
  { id:'newcastle',     name:'Newcastle',         center:[54.2178,-5.8951],   region:'Northern Ireland' },
  { id:'portadown',     name:'Portadown',         center:[54.4273,-6.4471],   region:'Northern Ireland' },
  { id:'craigavon',     name:'Craigavon',         center:[54.4645,-6.3375],   region:'Northern Ireland' },
  { id:'ballycastle',   name:'Ballycastle',       center:[55.2034,-6.2453],   region:'Northern Ireland' },
  { id:'banbridge',     name:'Banbridge',         center:[54.3484,-6.2705],   region:'Northern Ireland' },
  { id:'magherafelt',   name:'Magherafelt',       center:[54.7558,-6.6070],   region:'Northern Ireland' },
  { id:'perth',         name:'Perth',             center:[-31.9523,115.8613], region:'Australia' },
];

// Region groupings for the city picker, in display order.
const CITY_REGIONS = [...new Set(CITIES.map(c => c.region))];

// ── Perth, Australia — starter set of real City of Perth (CPP) car parks ──────
// Well-known public car parks to seed the city so it isn't empty. Coordinates
// are best-effort CBD locations; live rates/bays are in the CPP app. Owner to
// verify/refine over time as the community adds spots.
const PERTH_SPOTS = [
  { id:101, name:"His Majesty's Car Park",          near:"His Majesty's Theatre", tags:['perth cbd','his majesty','hay street','murray street','city centre','shopping'], badge:'official', dist:0, walk:'2 min', restriction:'Open 24/7',         notes:"City of Perth (CPP) car park at 25 Murray St, beside His Majesty's Theatre. Handy for the Hay St Mall and a show. Live bays and rates in the CPP app.", lat:-31.9522, lng:115.8556, by:'City of Perth Parking', votes:0, photo:null, price:null, spaces:null },
  { id:102, name:'Elizabeth Quay Car Park',          near:'Elizabeth Quay',        tags:['elizabeth quay','the esplanade','riverside','perth cbd','waterfront'],            badge:'official', dist:0, walk:'3 min', restriction:'Open 24/7',         notes:'CPP car park serving Elizabeth Quay and the riverfront — bars, restaurants and the ferry. Great weekend spot. Rates in the CPP app.', lat:-31.9591, lng:115.8588, by:'City of Perth Parking', votes:0, photo:null, price:null, spaces:null },
  { id:103, name:'Convention Centre Car Park',       near:'Perth Convention Centre',tags:['pcec','convention centre','mounts bay road','perth cbd','events'],                badge:'official', dist:0, walk:'2 min', restriction:'Open 24/7',         notes:'CPP car park at 21 Mounts Bay Rd under the Perth Convention & Exhibition Centre. Best for events and the western end of the CBD.', lat:-31.9573, lng:115.8533, by:'City of Perth Parking', votes:0, photo:null, price:null, spaces:null },
  { id:104, name:'State Library / Cultural Centre',  near:'Northbridge',            tags:['cultural centre','state library','art gallery','northbridge','roe street','perth cbd'], badge:'official', dist:0, walk:'3 min', restriction:'Open 24/7',     notes:'CPP car park off Roe St for the Perth Cultural Centre — State Library, Art Gallery, WA Museum Boola Bardip and Northbridge nightlife.', lat:-31.9486, lng:115.8601, by:'City of Perth Parking', votes:0, photo:null, price:null, spaces:null },
  { id:105, name:'Terrace Road Car Park',            near:'Langley Park',           tags:['terrace road','langley park','riverside','perth cbd','swan river'],               badge:'official', dist:0, walk:'On the road', restriction:'Open 24/7',     notes:'CPP car park on Terrace Rd overlooking Langley Park and the Swan River. Quieter eastern-CBD option with easy freeway access.', lat:-31.9560, lng:115.8642, by:'City of Perth Parking', votes:0, photo:null, price:null, spaces:null },
  { id:106, name:'Goderich Street Car Park',         near:'East Perth',             tags:['goderich street','east perth','royal perth hospital','perth cbd'],                badge:'official', dist:0, walk:'5 min', restriction:'Open 24/7',         notes:'Large CPP car park on Goderich St, East Perth — handy for Royal Perth Hospital and the eastern CBD. Usually has space on weekdays.', lat:-31.9558, lng:115.8703, by:'City of Perth Parking', votes:0, photo:null, price:null, spaces:null },
];

// ── Lisburn — starter set of real, well-known car parks (owner to verify) ─────
const LISBURN_SPOTS = [
  { id:201, name:'Bow Street Mall Car Park',   near:'Bow Street Mall',  tags:['lisburn','bow street','city centre','shopping','bow street mall'], badge:'official', dist:0, walk:'2 min', restriction:'Mall hours', notes:'Multi-storey at Bow Street Mall in the centre of Lisburn — the main shopping car park. Easy access to Bow St and Market Square.', lat:54.5101, lng:-6.0407, by:'Bow Street Mall', votes:0, photo:null, price:null, spaces:null },
  { id:202, name:'Lisburn Square Car Park',     near:'Lisburn Square',   tags:['lisburn','lisburn square','city centre','shopping'],               badge:'official', dist:0, walk:'2 min', restriction:'Mon–Sat 8am–6pm', notes:'Central car park beside Lisburn Square shops and restaurants. Handy for the city centre and Market Square.', lat:54.5108, lng:-6.0388, by:'Official', votes:0, photo:null, price:null, spaces:null },
  { id:203, name:'Smithfield Street Car Park',  near:'Lisburn centre',   tags:['lisburn','smithfield street','city centre'],                       badge:'timed',    dist:0, walk:'3 min', restriction:'Mon–Sat 8am–6pm', notes:'On-street/surface parking on Smithfield St. Free evenings and Sundays — short walk to the centre.', lat:54.5119, lng:-6.0412, by:'NorthAntrimLocal', votes:0, photo:null, price:null, spaces:null },
  { id:204, name:'Wallace Park',                near:'Wallace Park',     tags:['lisburn','wallace park','walks','free parking','dog walk'],         badge:'hidden_gem', dist:0, walk:'Trail start', restriction:'Free — park hours', notes:'Free parking at Wallace Park — Victorian park with walks, sports pitches and a duck pond. Great for families and dog walkers.', lat:54.5180, lng:-6.0360, by:'LisburnLocal', votes:0, photo:null, price:null, spaces:null, premium:false },
];

// ── Bangor — starter set of real, well-known car parks (owner to verify) ──────
const BANGOR_SPOTS = [
  { id:301, name:'Flagship Centre Car Park',    near:'Flagship Centre',  tags:['bangor','flagship centre','main street','town centre','shopping'], badge:'official', dist:0, walk:'1 min', restriction:'Centre hours', notes:'Car park at the Flagship Shopping Centre on Main St — central Bangor. Best for the town centre and seafront.', lat:54.6585, lng:-5.6705, by:'Flagship Centre', votes:0, photo:null, price:null, spaces:null },
  { id:302, name:'Quay Street Car Park',        near:'Bangor seafront',  tags:['bangor','quay street','seafront','marina','town centre'],          badge:'timed',    dist:0, walk:'2 min', restriction:'Mon–Sat 8am–6pm', notes:'Surface car park by the seafront and marina. Free evenings and Sundays — ideal for a walk along the front or Pickie Fun Park.', lat:54.6618, lng:-5.6690, by:'Official', votes:0, photo:null, price:null, spaces:null },
  { id:303, name:'Bangor Marina Car Park',      near:'Bangor Marina',    tags:['bangor','marina','seafront','eisenhower pier'],                    badge:'official', dist:0, walk:'1 min', restriction:'Open daily', notes:'Parking right at Bangor Marina and Eisenhower Pier. Great for the coastal path and waterfront restaurants.', lat:54.6640, lng:-5.6675, by:'Official', votes:0, photo:null, price:null, spaces:null },
  { id:304, name:'Marine Gardens / Seacliff Rd',near:'Ballyholme',       tags:['bangor','marine gardens','seacliff road','ballyholme','seafront','free parking'], badge:'hidden_gem', dist:0, walk:'On the road', restriction:'Free — no restrictions', notes:'Free on-street parking along Seacliff Rd towards Ballyholme. Lovely bay views and an easy coastal walk.', lat:54.6600, lng:-5.6620, by:'BangorLocal', votes:0, photo:null, price:null, spaces:null, premium:true },
];

// ── Newtownabbey — starter set of real, well-known car parks (owner to verify) ─
const NEWTOWNABBEY_SPOTS = [
  { id:401, name:'Abbeycentre Car Park',        near:'Abbeycentre',      tags:['newtownabbey','abbeycentre','shopping','free parking','retail park'], badge:'free',  dist:0, walk:'Right there', restriction:'Free — centre hours', notes:'Large free car park at the Abbeycentre shopping centre — always plenty of space. Use as a base for the area.', lat:54.6855, lng:-5.9160, by:'Abbeycentre', votes:0, photo:null, price:null, spaces:null },
  { id:402, name:'Valley Leisure Centre',       near:'Valley Park',      tags:['newtownabbey','valley park','valley leisure centre','walks','free parking','dog walk'], badge:'hidden_gem', dist:0, walk:'Trail start', restriction:'Free — park hours', notes:'Free parking at Valley Leisure Centre and the Valley Park — walking trails, playing fields and the leisure centre. ESB rapid + AC EV chargers on site (community estimate).', lat:54.6760, lng:-5.9300, by:'NewtownabbeyLocal', votes:0, photo:null, price:null, spaces:null, premium:false, ev:{available:true, ports:2, speed:'50kW DC'} },
];

// ── Derry~Londonderry ─────────────────────────────────────────────────────────
const DERRY_SPOTS = [
  { id:501, name:'Foyleside East Car Park', near:'Foyleside Shopping Centre', tags:['derry','foyleside','city centre','shopping','multi-storey'], badge:'official', dist:0, walk:'Right there', restriction:'Open 24/7 (East); shopping hours (West)', notes:'The primary multi-storey at Foyleside with ~1,500 combined spaces. Charges from £1.90/hr; East Car Park open 24 hrs, well-lit and CCTV monitored.', lat:54.9975, lng:-7.3125, by:'Official', votes:0, photo:null, price:'£1.90/hr', spaces:750 },
  { id:502, name:'Bishop Street Car Park', near:'Derry City Walls / Guildhall', tags:['derry','bishop street','city walls','city centre','pay and display'], badge:'official', dist:0, walk:'~3 min', restriction:'Mon-Sat 8am-6:30pm; free evenings & Sundays', notes:'Council Pay & Display with 158 spaces inside the walls, close to the Diamond and Guildhall. Free evenings and Sundays.', lat:54.9960, lng:-7.3195, by:'Official', votes:0, photo:null, price:'£0.80/hr', spaces:158 },
  { id:503, name:'Strand Road Car Park', near:'Richmond Centre / City Centre', tags:['derry','strand road','city centre','council'], badge:'official', dist:0, walk:'~4 min', restriction:'Mon-Sat 8am-6:30pm; free evenings & Sundays', notes:'Council surface car park with 70 spaces on Strand Road, handy for Richmond Centre and Craft Village. Free after 6:30pm.', lat:54.9988, lng:-7.3108, by:'Official', votes:0, photo:null, price:'£0.80/hr', spaces:70 },
  { id:504, name:"Queen's Quay Car Park", near:'Guildhall / River Foyle', tags:['derry','queens quay','guildhall','waterfront','river foyle'], badge:'hidden_gem', dist:0, walk:'~5 min', restriction:'Free all day', notes:"Free 37-space car park beside the River Foyle, short stroll from the Guildhall and Peace Bridge. Tucked away so it rarely fills — locals keep this one quiet.", lat:54.9978, lng:-7.3068, by:'Derry Local', votes:0, photo:null, price:null, spaces:37, premium:true },
  { id:505, name:'Foyle Road Car Park', near:'Craigavon Bridge / Foyle Valley Railway Museum', tags:['derry','foyle road','craigavon bridge','railway museum'], badge:'hidden_gem', dist:0, walk:'~6 min', restriction:'Free all day', notes:'Free 89-space surface car park off Foyle Road near the Railway Museum. 6-min walk to the city centre and usually has spaces when everything else is full.', lat:54.9950, lng:-7.3090, by:'Derry Local', votes:0, photo:null, price:null, spaces:89, premium:true },
  { id:506, name:'William Street Car Park', near:'Bogside / Museum of Free Derry', tags:['derry','william street','bogside','museum of free derry'], badge:'timed', dist:0, walk:'~7 min', restriction:'Mon-Sat 7:30am-10pm, Sun 9am-8pm', notes:'Council car park on William Street on the edge of the Bogside, handy for the Museum of Free Derry and 7 minutes to the Diamond.', lat:54.9976, lng:-7.3230, by:'Derry Local', votes:0, photo:null, price:'£0.80/hr', spaces:null },
  { id:507, name:'Carlisle Road Pay & Display', near:'Carlisle Road / Ferryquay Gate', tags:['derry','carlisle road','city walls','ferryquay gate','on-street'], badge:'timed', dist:0, walk:'~2 min', restriction:'Mon-Sat 8am-6:30pm; free evenings & Sundays', notes:'On-street Pay & Display bays along Carlisle Road outside Ferryquay Gate. 22 spaces that turn over fast — ideal for a quick city-walls visit.', lat:54.9940, lng:-7.3175, by:'Derry Local', votes:0, photo:null, price:'£0.80/hr', spaces:22 },
  { id:508, name:'Spencer Road Car Park', near:'Waterside / Ebrington Square', tags:['derry','spencer road','waterside','ebrington'], badge:'free', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Free council car park in the Waterside, short walk across the Peace Bridge to the city centre. Avoids city-centre charges entirely.', lat:54.9990, lng:-7.2970, by:'Derry Local', votes:0, photo:null, price:null, spaces:null },
  { id:509, name:'Victoria Market Car Park', near:'Victoria Market / Strand Road', tags:['derry','victoria market','strand road','city centre'], badge:'official', dist:0, walk:'~3 min', restriction:'Mon-Sat 8am-6:30pm; free evenings & Sundays', notes:'Council surface car park with 81 spaces at Victoria Market, convenient for Strand Road shops and Quayside Shopping Centre.', lat:54.9994, lng:-7.3098, by:'Official', votes:0, photo:null, price:'£0.80/hr', spaces:81 },
  { id:510, name:'Fort George Event Car Park', near:'Fort George / Ebrington / Peace Bridge', tags:['derry','fort george','ebrington','peace bridge','free'], badge:'free', dist:0, walk:'~10 min', restriction:'Free all day; busy during events', notes:'Large free surface car park at former Fort George site on the east bank. Walk across the Peace Bridge in ~10 min — best bet during Halloween when cityside parks jam up.', lat:55.0008, lng:-7.2955, by:'Derry Local', votes:0, photo:null, price:null, spaces:null },
];

// ── Newry ─────────────────────────────────────────────────────────────────────
const NEWRY_SPOTS = [
  { id:531, name:'Buttercrane Shopping Centre Car Park', near:'Buttercrane Shopping Centre', tags:['newry','buttercrane','shopping','multi-storey','city centre'], badge:'official', dist:0, walk:'Right there', restriction:'Mon-Sat 8am-10pm, Sun 1pm-6pm', notes:"Newry's largest car park with over 1,000 spaces. £1/hr with free 1.5 hrs if you spend £10 in-store. Sunday all-day just £1.", lat:54.1745, lng:-6.3378, by:'Official', votes:0, photo:null, price:'£1/hr', spaces:1000 },
  { id:532, name:'The Quays Shopping Centre Car Park', near:'The Quays Shopping Centre', tags:['newry','the quays','shopping','bridge street','canal'], badge:'official', dist:0, walk:'Right there', restriction:'Open during centre hours', notes:'Large surface and multi-level car park at The Quays on Bridge Street with over 1,300 spaces. Automated barrier with pay-on-foot machines inside.', lat:54.1762, lng:-6.3358, by:'Official', votes:0, photo:null, price:'£1.50/hr', spaces:1300 },
  { id:533, name:'Abbey Way Car Park', near:'Newry Cathedral / Cathedral Quarter', tags:['newry','abbey way','cathedral quarter','cathedral'], badge:'official', dist:0, walk:'~3 min', restriction:'Mon-Sat 8:30am-6:30pm', notes:'Council Pay & Display with 280 spaces at just 40p/hr — one of the cheapest paid car parks in Newry. Close to the Cathedral and city centre shops.', lat:54.1768, lng:-6.3421, by:'Official', votes:0, photo:null, price:'40p/hr', spaces:280 },
  { id:534, name:'North Street Free Car Park', near:'Newry City Centre / Hill Street', tags:['newry','north street','free parking','city centre'], badge:'free', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Large informal surface car park with ~250 free spaces just off the city centre. Very popular — fills fast on weekday mornings.', lat:54.1780, lng:-6.3430, by:'Newry Local', votes:0, photo:null, price:null, spaces:250 },
  { id:535, name:'Edward Street Car Park', near:'Newry City Centre / Merchants Quay', tags:['newry','edward street','free parking','canal'], badge:'free', dist:0, walk:'~4 min', restriction:'Free all day', notes:'Small free council car park with ~20 spaces on Edward Street near Merchants Quay. Gets busy at lunch but available early morning and after 3pm.', lat:54.1758, lng:-6.3395, by:'Newry Local', votes:0, photo:null, price:null, spaces:20 },
  { id:536, name:'Canal Bank Car Park', near:'Newry Canal / Newry Rowing Club', tags:['newry','canal bank','canal','free parking'], badge:'hidden_gem', dist:0, walk:'~6 min', restriction:'Free all day', notes:'Quiet free car park along the banks of the historic Newry Canal — very few visitors know about it. Walk along the towpath straight into the city centre.', lat:54.1735, lng:-6.3412, by:'Newry Local', votes:0, photo:null, price:null, spaces:13, premium:true },
  { id:537, name:'Basin Walk Car Park', near:'Newry Canal Basin / town centre', tags:['newry','basin walk','canal basin','paid parking'], badge:'paid', dist:0, walk:'~5 min', restriction:'Mon-Sat 8:30am-6:30pm', notes:'Council Pay & Display near the Canal Basin with 67 spaces at just 40p/hr — great value. Free outside enforcement hours.', lat:54.1728, lng:-6.3398, by:'Official', votes:0, photo:null, price:'40p/hr', spaces:67 },
  { id:538, name:'Monaghan Street Car Park', near:'Newry Bus Station / town centre', tags:['newry','monaghan street','bus station','city centre'], badge:'official', dist:0, walk:'~3 min', restriction:'Mon-Sat 8am-6:30pm', notes:'Council Pay & Display on Monaghan Street, handy for the bus station and central shopping streets. Used heavily by commuters arriving into Newry.', lat:54.1756, lng:-6.3445, by:'Official', votes:0, photo:null, price:'50p/hr', spaces:80 },
  { id:539, name:'Hill Street On-Street Parking', near:'Hill Street / Newry shops', tags:['newry','hill street','on-street','timed','city centre'], badge:'timed', dist:0, walk:'Right there', restriction:'Mon-Sat 8am-6pm, max 1 hr', notes:'On-street Pay & Display bays on Hill Street at the heart of the retail core. Free evenings and all day Sunday.', lat:54.1763, lng:-6.3408, by:'Newry Local', votes:0, photo:null, price:'£1.50/hr', spaces:null },
  { id:540, name:'Railway Avenue Free Parking', near:'Newry Train Station / Dublin Road', tags:['newry','railway avenue','train station','free parking'], badge:'hidden_gem', dist:0, walk:'~7 min', restriction:'Free all day', notes:'Quiet residential street near Newry train station with free all-day parking — ideal for commuters or anyone heading into town on foot. Very few tourists know to park here.', lat:54.1794, lng:-6.3377, by:'Newry Local', votes:0, photo:null, price:null, spaces:null, premium:true },
];

// ── Antrim ────────────────────────────────────────────────────────────────────
const ANTRIM_SPOTS = [
  { id:561, name:'Central Car Park, Castle Way', near:'Castle Mall Shopping Centre', tags:['antrim','castle mall','market square','town centre','free'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day', notes:'Large surface car park directly next to Castle Mall — the main free town centre car park. Managed by Antrim & Newtownabbey Borough Council. Fills quickly Saturdays.', lat:54.7198, lng:-6.2100, by:'Official', votes:0, photo:null, price:null, spaces:200 },
  { id:562, name:'Railway Street Car Park', near:'Antrim Courthouse / Town Centre', tags:['antrim','railway street','town centre','courthouse','paid'], badge:'paid', dist:0, walk:'~3 min', restriction:'Mon-Sat, charges apply', notes:'Council Pay & Display off Railway Street, close to the courthouse and town centre at a very low rate. Cashless payment via JustPark app.', lat:54.7185, lng:-6.2108, by:'Official', votes:0, photo:null, price:'£0.40/hr', spaces:80 },
  { id:563, name:'Dublin Road / Bridge Street Car Park', near:'Antrim Town Centre / Dublin Road', tags:['antrim','dublin road','bridge street','ev charging'], badge:'official', dist:0, walk:'~5 min', restriction:'Open daily, charges apply', notes:'DRD-managed car park at Dublin Road and Bridge Street with EV charging points on site. Short walk up into the town centre.', lat:54.7170, lng:-6.2132, by:'Official', votes:0, photo:null, price:'£2.70/10hrs', spaces:100 },
  { id:564, name:'Antrim Castle Gardens Car Park', near:'Antrim Castle Gardens / Clotworthy House', tags:['antrim','castle gardens','clotworthy house','randalstown road','free','heritage'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day, gardens hours apply', notes:'Free car park at the historic Antrim Castle Gardens on Randalstown Road. Great base for visiting Clotworthy House and the gardens. Busy during events.', lat:54.7228, lng:-6.2178, by:'Official', votes:0, photo:null, price:null, spaces:60 },
  { id:565, name:'Church Street On-Street', near:'Antrim Town Centre / Church Street', tags:['antrim','church street','on-street','timed','town centre'], badge:'timed', dist:0, walk:'~2 min', restriction:'1 hr limit Mon-Sat 9am-5pm, no return within 2 hrs', notes:'On-street spaces along Church Street in the heart of Antrim. The 1-hour limit is strictly enforced during the week. Free evenings and Sundays.', lat:54.7195, lng:-6.2090, by:'Antrim Local', votes:0, photo:null, price:null, spaces:15 },
  { id:566, name:'High Street On-Street', near:'Antrim High Street shops', tags:['antrim','high street','on-street','timed','shopping'], badge:'timed', dist:0, walk:'~2 min', restriction:'1 hr limit Mon-Sat 9am-5pm', notes:'Limited on-street parking on High Street giving direct access to independent shops and cafes. Free outside restricted hours.', lat:54.7202, lng:-6.2083, by:'Antrim Local', votes:0, photo:null, price:null, spaces:10 },
  { id:567, name:'Steeple Road On-Street', near:'Antrim Round Tower', tags:['antrim','steeple road','round tower','free','hidden gem'], badge:'hidden_gem', dist:0, walk:'~2 min', restriction:'Free all day', notes:'Quiet residential on-street parking along Steeple Road, short walk from the famous Antrim Round Tower. Virtually unknown to visitors. Completely free with no restrictions.', lat:54.7258, lng:-6.2082, by:'Antrim Local', votes:0, photo:null, price:null, spaces:20, premium:true },
  { id:568, name:'Tesco Extra Car Park, Castle Way', near:'Tesco Extra / Castle Mall', tags:['antrim','tesco','castle way','supermarket','free','hidden gem'], badge:'hidden_gem', dist:0, walk:'~4 min', restriction:'Free, customers only', notes:'The large Tesco Extra car park on Castle Way has overflow capacity locals use for a quick town centre visit. Far less busy than the Central Car Park on weekends.', lat:54.7205, lng:-6.2115, by:'Antrim Local', votes:0, photo:null, price:null, spaces:300, premium:false },
  { id:569, name:'Fountain Street On-Street', near:'Antrim Town Centre', tags:['antrim','fountain street','on-street','free','town centre'], badge:'free', dist:0, walk:'~3 min', restriction:'Free where not restricted', notes:'A handful of unrestricted on-street spaces at the southern end of Fountain Street. Often overlooked as most people head for the central car parks.', lat:54.7188, lng:-6.2075, by:'Antrim Local', votes:0, photo:null, price:null, spaces:8 },
  { id:570, name:'Greystone Road On-Street', near:'Antrim Leisure Centre / Town Centre', tags:['antrim','greystone road','on-street','free','leisure centre'], badge:'free', dist:0, walk:'~6 min', restriction:'Free all day', notes:'Unrestricted on-street parking along Greystone Road on the western edge of town. Useful when central car parks are full on market days.', lat:54.7215, lng:-6.2205, by:'Antrim Local', votes:0, photo:null, price:null, spaces:25 },
];

// ── Ballymena ─────────────────────────────────────────────────────────────────
const BALLYMENA_SPOTS = [
  { id:601, name:'Springwell Street Multi-Storey Car Park', near:'Tower Centre Ballymena', tags:['ballymena','tower centre','springwell street','multi-storey','town centre'], badge:'official', dist:0, walk:'~2 min', restriction:'Mon-Sat 7am-10pm, Sun charged', notes:'Main multi-storey serving the Tower Centre with 812 spaces. Charged at 70p/hr — the only council car park that charges on Sundays.', lat:54.8638, lng:-6.2745, by:'Official', votes:0, photo:null, price:'70p/hr', spaces:812 },
  { id:602, name:'Fairhill Shopping Centre Car Park', near:'Fairhill Shopping Centre', tags:['ballymena','fairhill','broughshane street','shopping','multi-storey'], badge:'official', dist:0, walk:'Right there', restriction:'Free Thu & Fri 6pm-9pm, all day Sun free', notes:'Large privately operated multi-storey at Fairhill with over 1,100 spaces. EV charging available. First hour just £1.', lat:54.8665, lng:-6.2712, by:'Official', votes:0, photo:null, price:'£1/hr (1st hr)', spaces:1100 },
  { id:603, name:'Mount Street Free Car Park', near:'Ballymena Town Centre', tags:['ballymena','mount street','free parking','town centre','council'], badge:'free', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Council surface car park on Mount Street made permanently free after the 2024 parking charges u-turn. Solid free option a short walk from the town centre.', lat:54.8627, lng:-6.2798, by:'Ballymena Local', votes:0, photo:null, price:null, spaces:84 },
  { id:604, name:'Broughshane Street Free Car Park', near:'Fairhill Shopping Centre', tags:['ballymena','broughshane street','free parking','fairhill','council'], badge:'free', dist:0, walk:'~3 min', restriction:'Free all day', notes:'Surface car park off Broughshane Street freed from charges by the council in 2024. Handy for Fairhill and the north end of the town centre.', lat:54.8671, lng:-6.2725, by:'Ballymena Local', votes:0, photo:null, price:null, spaces:76 },
  { id:605, name:'Church Street Car Park 1', near:'Ballymena Town Hall / Church Street', tags:['ballymena','church street','town centre','council','pay and display'], badge:'paid', dist:0, walk:'~3 min', restriction:'Mon-Sat charged, Sun free', notes:'Council Pay & Display surface car park off Church Street near Demesne Avenue. At just 60p/hr among the cheapest paid parking in any NI town. Free all day Sunday.', lat:54.8642, lng:-6.2763, by:'Official', votes:0, photo:null, price:'60p/hr', spaces:199 },
  { id:606, name:'Ballymoney Road Car Park', near:'Harryville area / Ballymena', tags:['ballymena','ballymoney road','harryville','council','pay and display'], badge:'paid', dist:0, walk:'~6 min', restriction:'Mon-Sat charged, Sun free', notes:'Council Pay & Display on Ballymoney Road serving the Harryville end of town. 60p/hr good value if heading to the southern part of the town centre.', lat:54.8598, lng:-6.2741, by:'Official', votes:0, photo:null, price:'60p/hr', spaces:80 },
  { id:607, name:'Wellington Street On-Street Parking', near:'Tower Centre / Ballymena town centre', tags:['ballymena','wellington street','on-street','tower centre','timed'], badge:'timed', dist:0, walk:'~1 min', restriction:'Mon-Sat 8am-6pm limited; free evenings & Sun', notes:'On-street spaces directly outside the Tower Centre on Wellington Street. Free after 6pm and all day Sunday.', lat:54.8644, lng:-6.2758, by:'Ballymena Local', votes:0, photo:null, price:null, spaces:20 },
  { id:608, name:'Park Street Quiet Free Layby', near:'Mount Street Car Park / Town Centre', tags:['ballymena','park street','mount street','free parking','hidden gem','quiet'], badge:'hidden_gem', dist:0, walk:'~6 min', restriction:'Free all day', notes:'Quiet stretch of free on-street parking on Park Street alongside the Mount Street area — often overlooked by visitors who head straight to the paid multi-storey.', lat:54.8622, lng:-6.2805, by:'Ballymena Local', votes:0, photo:null, price:null, spaces:15, premium:true },
  { id:609, name:'Circular Road East Free Car Park', near:'East Ballymena / Braid area', tags:['ballymena','circular road','braid','east ballymena','free parking','hidden gem'], badge:'hidden_gem', dist:0, walk:'~8 min', restriction:'Free all day', notes:'Council car park on Circular Road East — charges dropped in 2024 and remains largely unknown to casual visitors. Short walk into town from the east side.', lat:54.8651, lng:-6.2670, by:'Ballymena Local', votes:0, photo:null, price:null, spaces:50, premium:true },
  { id:610, name:'Church Street 3 (Braid) Car Park', near:'Braid Arts Centre / Church Street', tags:['ballymena','church street','braid','arts centre','council','paid'], badge:'paid', dist:0, walk:'~4 min', restriction:'Mon-Sat charged, Sun free', notes:'Council Pay & Display near the Braid Arts Centre and Trostan Avenue. Closest of three Church Street car parks to the leisure and arts quarter. Very affordable at 60p/hr.', lat:54.8636, lng:-6.2770, by:'Official', votes:0, photo:null, price:'60p/hr', spaces:140 },
];

// ── Coleraine ─────────────────────────────────────────────────────────────────
const COLERAINE_SPOTS = [
  { id:631, name:'Railway Road Car Park', near:'Coleraine Town Centre / Diamond Centre', tags:['coleraine','railway road','town centre','diamond centre','pay and display'], badge:'official', dist:0, walk:'2 min', restriction:'Mon-Sat 8:30am-6:30pm, free Sundays', notes:"Coleraine's largest council car park with 321 spaces. Free on Sundays, short walk to the Diamond Centre and main retail streets.", lat:55.1336, lng:-6.6625, by:'Official', votes:0, photo:null, price:'£0.40/hr', spaces:321 },
  { id:632, name:'Abbey Street Car Park', near:'Coleraine Town Centre / The Diamond', tags:['coleraine','abbey street','town centre','the diamond','pay and display'], badge:'official', dist:0, walk:'3 min', restriction:'Mon-Sat 8:30am-6:30pm, free Sundays', notes:'Large 174-space council Pay & Display right in the heart of Coleraine, close to the Diamond shopping area and Church Street.', lat:55.1322, lng:-6.6672, by:'Official', votes:0, photo:null, price:'£0.60/hr', spaces:174 },
  { id:633, name:'Long Commons Car Park', near:'Coleraine Leisure Centre / Indoor Market', tags:['coleraine','long commons','leisure centre','indoor market','council'], badge:'official', dist:0, walk:'5 min', restriction:'Mon-Sat 8:30am-6:30pm, free Sundays', notes:'128-space council car park at Long Commons, handy for the Leisure Centre and Indoor Market. Cheaper at 50p/hr, free on Sundays.', lat:55.1348, lng:-6.6641, by:'Official', votes:0, photo:null, price:'£0.50/hr', spaces:128 },
  { id:634, name:'Church Street Pay & Display', near:'Diamond Centre / Coleraine town centre', tags:['coleraine','church street','town centre','diamond centre','shopping'], badge:'paid', dist:0, walk:'Right there', restriction:'Mon-Sat 8:30am-6:30pm', notes:'96-space Pay & Display on Church Street, one of the main shopping streets. Very central with electronic signage showing live availability.', lat:55.1330, lng:-6.6660, by:'Official', votes:0, photo:null, price:'£0.50/hr', spaces:96 },
  { id:635, name:'Railway Place Car Park', near:'Coleraine Railway Station / Bus Station', tags:['coleraine','railway place','train station','bus station','park and ride','commuter'], badge:'official', dist:0, walk:'Right there', restriction:'Mon-Sat 8:30am-6:30pm, free Sundays', notes:'Council car park directly beside Coleraine railway and bus station. Ideal for commuters and visitors arriving by rail.', lat:55.1353, lng:-6.6597, by:'Official', votes:0, photo:null, price:'£0.40/hr', spaces:150 },
  { id:636, name:'Circular Road On-Street Parking', near:'Diamond Centre / Coleraine town centre', tags:['coleraine','circular road','on-street','timed','town centre'], badge:'timed', dist:0, walk:'3 min', restriction:'Mon-Sat daytime, free evenings & Sundays', notes:'On-street timed spaces along Circular Road on the edge of the town centre. Free after hours and on Sundays.', lat:55.1318, lng:-6.6648, by:'Coleraine Local', votes:0, photo:null, price:null, spaces:null },
  { id:637, name:'Waterside Car Park (Castle Place)', near:'River Bann footbridge / Coleraine town centre', tags:['coleraine','waterside','castle place','river bann','free parking','hidden gem'], badge:'hidden_gem', dist:0, walk:'~7 min', restriction:'Free, arrive by 9am on weekdays', notes:'Free car park on the Waterside at Castle Place beside the River Bann. Cross the footbridge to reach the town centre in about 7 minutes. Popular with locals who arrive early.', lat:55.1295, lng:-6.6690, by:'Coleraine Local', votes:0, photo:null, price:null, spaces:null, premium:true },
  { id:638, name:'Kingsgate Street On-Street', near:'Coleraine town centre / The Diamond', tags:['coleraine','kingsgate street','on-street','free','quiet'], badge:'free', dist:0, walk:'5 min', restriction:'Free all day', notes:'Quiet residential side street a few minutes walk north of the Diamond. Free unrestricted parking that most visitors overlook — reliable backup on market days.', lat:55.1341, lng:-6.6700, by:'Coleraine Local', votes:0, photo:null, price:null, spaces:null },
  { id:639, name:'Beresford Avenue On-Street', near:'Coleraine town centre / Coleraine Museum', tags:['coleraine','beresford avenue','on-street','free','hidden gem','museum'], badge:'hidden_gem', dist:0, walk:'~6 min', restriction:'Free all day', notes:'Lesser-known free on-street option on Beresford Avenue, short walk from the town centre and handy for Coleraine Museum. Locals use it to avoid town centre charges entirely.', lat:55.1310, lng:-6.6720, by:'Coleraine Local', votes:0, photo:null, price:null, spaces:null, premium:true },
];

// ── Portrush ──────────────────────────────────────────────────────────────────
const PORTRUSH_SPOTS = [
  { id:661, name:'East Strand Pay & Display Car Park', near:'East Strand Beach', tags:['portrush','east strand','beach','causeway street','pay display'], badge:'official', dist:0, walk:'Right there', restriction:'Mon-Sun 8:30am-6:30pm', notes:'Largest car park in Portrush with 537 spaces right beside East Strand Beach. Pay & Display by Causeway Coast & Glens Borough Council. Fills fast in summer.', lat:55.2092, lng:-6.6521, by:'Official', votes:0, photo:null, price:'50p/hr', spaces:537 },
  { id:662, name:'Dunluce Avenue Car Park', near:'Portrush Town Centre', tags:['portrush','dunluce avenue','town centre','ev charging'], badge:'official', dist:0, walk:'~3 min', restriction:'Mon-Sun 8:30am-6:30pm', notes:'Central council car park with 240 spaces and EV charging. Tends to be quieter than East Strand so better chance of a space mid-morning.', lat:55.2063, lng:-6.6587, by:'Official', votes:0, photo:null, price:'50p/hr', spaces:240 },
  { id:663, name:'Harbour Road Car Park', near:'Portrush Harbour', tags:['portrush','harbour','harbour road','ramore restaurant'], badge:'paid', dist:0, walk:'Right there', restriction:'Mon-Sun 8:30am-9:30pm', notes:'Small 36-space car park right at Portrush Harbour — handy for the Ramore restaurants. Fills very quickly on summer evenings.', lat:55.2082, lng:-6.6638, by:'Official', votes:0, photo:null, price:'£1/hr', spaces:36 },
  { id:664, name:'West Bay Car Park', near:'West Strand Beach', tags:['portrush','west bay','west strand','beach','seasonal'], badge:'official', dist:0, walk:'Right there', restriction:'Seasonal: Apr-Sep 8:30am-6:30pm 50p/hr; free Oct-Mar', notes:'Spacious car park overlooking West Strand Beach — free all winter and only charged seasonally. Great sea views.', lat:55.2071, lng:-6.6720, by:'Official', votes:0, photo:null, price:'50p/hr (Apr-Sep)', spaces:120 },
  { id:665, name:'Glen Road Car Park', near:'Tides Bar & Restaurant', tags:['portrush','glen road','tides bar','town centre','height restriction'], badge:'paid', dist:0, walk:'~2 min', restriction:'Mon-Sun daytime, charges apply; height restriction', notes:'Compact car park on Glen Road opposite the Tides bar — note the height restriction so vans and campervans cannot use it.', lat:55.2068, lng:-6.6604, by:'Portrush Local', votes:0, photo:null, price:'50p/hr', spaces:60 },
  { id:666, name:'Kerr Street On-Street Parking', near:'Portrush Town Centre', tags:['portrush','kerr street','on-street','town centre','timed'], badge:'timed', dist:0, walk:'~2 min', restriction:'Mon-Sat 8am-6pm limited; free evenings & Sundays', notes:'On-street bays along Kerr Street, short walk from the main shopping street. Free after 6pm and all day Sunday.', lat:55.2058, lng:-6.6572, by:'Portrush Local', votes:0, photo:null, price:null, spaces:null },
  { id:667, name:'Bath Road On-Street Parking', near:'East Strand Beach', tags:['portrush','bath road','on-street','east strand','timed'], badge:'timed', dist:0, walk:'~4 min', restriction:'Mon-Sat 8am-6pm limited; free evenings & Sundays', notes:'Residential on-street spaces along Bath Road parallel to East Strand — often overlooked by visitors heading to the pay car park. Free evenings for a sunset walk.', lat:55.2088, lng:-6.6543, by:'Portrush Local', votes:0, photo:null, price:null, spaces:null },
  { id:668, name:'Ramore Avenue Residential Lay-bys', near:'Ramore Head', tags:['portrush','ramore avenue','ramore head','free parking','hidden gem'], badge:'hidden_gem', dist:0, walk:'~3 min', restriction:'Free, no time restrictions', notes:'Free unrestricted lay-by spaces along Ramore Avenue on the peninsula approach to Ramore Head. Visitors queue for the Harbour lot — locals park here and walk down in minutes. Stunning views of both bays.', lat:55.2098, lng:-6.6658, by:'Portrush Local', votes:0, photo:null, price:null, spaces:null, premium:true },
  { id:669, name:'Mark Street Residential On-Street', near:'Portrush Town Centre & West Strand', tags:['portrush','mark street','residential','free parking','hidden gem','west strand'], badge:'hidden_gem', dist:0, walk:'~5 min', restriction:'Free, no time restrictions', notes:'Quiet residential on-street parking on Mark Street — one of three parallel streets most tourists ignore. Five-minute flat walk to both the harbour and West Strand Beach. Completely free all day.', lat:55.2078, lng:-6.6698, by:'Portrush Local', votes:0, photo:null, price:null, spaces:null, premium:true },
  { id:670, name:'Sandhill Drive Motorhome & Overflow Area', near:'East Strand & Town Centre', tags:['portrush','sandhill drive','motorhome','overflow','campervan','east strand'], badge:'free', dist:0, walk:'~6 min', restriction:'Open access; motorhome aire facilities on site', notes:'Council-designated motorhome parking and service point on Sandhill Drive, within easy walking distance of East Strand and town centre. Also used as overflow during busy events.', lat:55.2110, lng:-6.6490, by:'Official', votes:0, photo:null, price:null, spaces:null },
];

// ── Carrickfergus ─────────────────────────────────────────────────────────────
const CARRICKFERGUS_SPOTS = [
  { id:691, name:'Castle Car Park', near:'Carrickfergus Castle', tags:['carrickfergus','castle','marina','harbour','waterfront'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day, Open 24/7', notes:'Large surface car park directly in front of Carrickfergus Castle on Marine Highway. Council confirmed it will remain free following a 2024 u-turn on charging plans. Public toilets on site.', lat:54.7148, lng:-5.8070, by:'Official', votes:0, photo:null, price:null, spaces:150 },
  { id:692, name:'St Brides Street Park & Ride', near:'De Courcy Shopping Centre', tags:['carrickfergus','park and ride','st brides','north road','de courcy','free parking'], badge:'free', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Large free car park off North Road with over 200 spaces. Walk through the stone arch into the De Courcy Centre to reach the town centre.', lat:54.7195, lng:-5.8115, by:'Official', votes:0, photo:null, price:null, spaces:200 },
  { id:693, name:'Lancasterian Street Car Park', near:'Carrickfergus Town Centre', tags:['carrickfergus','lancasterian street','town centre','pay and display'], badge:'official', dist:0, walk:'~2 min', restriction:'Mon-Sat 8am-6pm, pay & display', notes:'Council-managed Pay & Display surface car park near the town centre, one of the main options for shoppers on the High Street.', lat:54.7168, lng:-5.8098, by:'Official', votes:0, photo:null, price:'£0.50/hr', spaces:80 },
  { id:694, name:'High Street Car Park', near:'Carrickfergus High Street', tags:['carrickfergus','high street','town centre','shopping','pay and display'], badge:'official', dist:0, walk:'Right there', restriction:'Mon-Sat 8am-6pm, pay & display', notes:'Central Pay & Display car park directly off High Street, ideal for town centre shopping.', lat:54.7158, lng:-5.8087, by:'Official', votes:0, photo:null, price:'£0.50/hr', spaces:60 },
  { id:695, name:'Castle Street On-Street', near:'Carrickfergus Town Centre', tags:['carrickfergus','castle street','on-street','timed','town centre'], badge:'timed', dist:0, walk:'~2 min', restriction:'1 hr max Mon-Sat 8am-6pm, free evenings & Sundays', notes:'On-street parking bays on Castle Street with a 1-hour limit during shopping hours. Free after 6pm and all day Sunday.', lat:54.7155, lng:-5.8075, by:'Carrickfergus Local', votes:0, photo:null, price:null, spaces:20 },
  { id:696, name:'Harbour Car Park (Motorhome Aire)', near:'Carrickfergus Harbour & Marina', tags:['carrickfergus','harbour','marina','motorhome','waterfront'], badge:'free', dist:0, walk:'~3 min', restriction:'Free all day', notes:'Free surface car park at Carrickfergus Harbour close to the marina and within sight of the castle. Designated official motorhome aire service point.', lat:54.7143, lng:-5.8045, by:'Official', votes:0, photo:null, price:null, spaces:80 },
  { id:697, name:'Marine Gardens Car Park', near:'Carrickfergus Marine Gardens & Promenade', tags:['carrickfergus','marine gardens','promenade','seafront','accessible'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day', notes:'Quiet free car park next to Marine Gardens play park along the promenade. Accessible spaces available. Far less busy than the main castle car park on summer weekends — a genuine local tip.', lat:54.7138, lng:-5.8020, by:'Carrickfergus Local', votes:0, photo:null, price:null, spaces:40, premium:true },
  { id:698, name:'Carrickfergus Train Station Car Park', near:'Carrickfergus Railway Station', tags:['carrickfergus','train station','railway','park and ride','translink','commuter'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day', notes:'Free park-and-ride car park adjacent to Carrickfergus railway station. Perfect for commuters heading to Belfast. Also handy overflow for town centre visits.', lat:54.7183, lng:-5.8132, by:'Official', votes:0, photo:null, price:null, spaces:100 },
  { id:699, name:'Scotch Quarter Side Streets', near:'Scotch Quarter / Carrickfergus', tags:['carrickfergus','scotch quarter','on-street','hidden gem','free','evening parking'], badge:'hidden_gem', dist:0, walk:'~4 min', restriction:'Free evenings & Sundays, 1 hr daytime', notes:'Residential side streets off Scotch Quarter near the old town offer free parking in the evenings and Sundays. Locals use these to avoid castle car park crowds during summer events.', lat:54.7162, lng:-5.8055, by:'Carrickfergus Local', votes:0, photo:null, price:null, spaces:null, premium:true },
  { id:700, name:'Windrose / Rodgers Quay Overflow', near:'Carrickfergus Marina / The Windrose Restaurant', tags:['carrickfergus','marina','windrose','rodgers quay','harbour','hidden gem'], badge:'hidden_gem', dist:0, walk:'~2 min', restriction:'Free, no restrictions observed', notes:'Small informal parking area at Rodgers Quay near the marina and The Windrose restaurant. Rarely full outside major events with great harbour views.', lat:54.7140, lng:-5.8062, by:'Carrickfergus Local', votes:0, photo:null, price:null, spaces:25 },
];

// ── Larne ─────────────────────────────────────────────────────────────────────
const LARNE_SPOTS = [
  { id:721, name:'Agnew Street Car Park', near:'Larne Main Street', tags:['larne','town centre','main street','agnew street','pay and display'], badge:'official', dist:0, walk:'2 min', restriction:'Mon-Sat 8am-6pm, 60p/hr', notes:'Council-run Pay & Display right in the heart of Larne town centre, steps from Main Street shops. Has EV charging point.', lat:54.8517, lng:-5.8162, by:'Official', votes:0, photo:null, price:'60p/hr', spaces:120 },
  { id:722, name:'Fairhill Car Park', near:'Larne Museum & Arts Centre', tags:['larne','fairhill','victoria road','museum','arts centre','pay and display'], badge:'official', dist:0, walk:'3 min', restriction:'Mon-Sat 8am-6pm, 60p/hr', notes:'Council Pay & Display on Victoria Road, directly opposite Larne Museum & Arts Centre. Often quieter than Agnew Street.', lat:54.8530, lng:-5.8178, by:'Official', votes:0, photo:null, price:'60p/hr', spaces:80 },
  { id:723, name:'Exchange Road Car Park', near:'Larne Harbour', tags:['larne','exchange road','harbour','free parking','ferry','port'], badge:'free', dist:0, walk:'5 min', restriction:'Free all day', notes:'Free council car park close to the harbour area. Solid alternative to paid town centre car parks — short flat walk to Main Street shops.', lat:54.8480, lng:-5.8155, by:'Larne Local', votes:0, photo:null, price:null, spaces:60 },
  { id:724, name:'Narrow Gauge Road Car Park', near:'Larne Market Yard', tags:['larne','narrow gauge road','market yard','inver','free parking'], badge:'free', dist:0, walk:'4 min', restriction:'Free all day', notes:'Free council car park off Narrow Gauge Road, very handy for the Wednesday market at Larne Market Yard.', lat:54.8495, lng:-5.8225, by:'Larne Local', votes:0, photo:null, price:null, spaces:70 },
  { id:725, name:'Circular Road West Car Park', near:'Laharna Retail Park', tags:['larne','circular road','laharna','retail park','paid parking'], badge:'paid', dist:0, walk:'Right there', restriction:'Mon-Sat 8am-6pm, 60p/hr', notes:'Council Pay & Display adjacent to Laharna Retail Park on Circular Road. The retail park itself also has 191 free customer spaces.', lat:54.8506, lng:-5.8165, by:'Official', votes:0, photo:null, price:'60p/hr', spaces:90 },
  { id:726, name:'Inver Road Free Car Park', near:'Curran Park', tags:['larne','inver road','curran park','free parking','seafront'], badge:'free', dist:0, walk:'6 min', restriction:'Free all day', notes:'Free council car park on Inver Road near Curran Park and the seafront. Quiet spot with less footfall than town centre car parks.', lat:54.8472, lng:-5.8200, by:'Larne Local', votes:0, photo:null, price:null, spaces:50 },
  { id:727, name:'Main Street On-Street Parking', near:'Larne Main Street shops', tags:['larne','main street','town centre','on-street','timed','shopping'], badge:'timed', dist:0, walk:'Right there', restriction:'Mon-Sat 9am-6pm, 1 hr max; free evenings & Sundays', notes:'On-street parking bays running along Larne Main Street. Free after 6pm and all day Sunday. Get here early on a weekday morning.', lat:54.8502, lng:-5.8195, by:'Larne Local', votes:0, photo:null, price:null, spaces:null },
  { id:728, name:'Victoria Road On-Street (The Roddens end)', near:'Larne Museum & Arts Centre', tags:['larne','victoria road','the roddens','free on-street','museum','hidden gem'], badge:'hidden_gem', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Free unrestricted on-street parking along Victoria Road near The Roddens. Confirmed by the council as an alternative to the Fairhill Pay & Display. Most visitors pay at Fairhill instead.', lat:54.8555, lng:-5.8210, by:'Larne Local', votes:0, photo:null, price:null, spaces:null, premium:true },
  { id:729, name:'Riverdale Car Park', near:'Larne Town Centre (west side)', tags:['larne','riverdale','free parking','town centre','hidden gem'], badge:'hidden_gem', dist:0, walk:'4 min', restriction:'Free all day', notes:'Lesser-known free council car park on the western fringe of Larne town centre. Locals use it to avoid the paid car parks — a genuine free alternative just a short walk from Main Street.', lat:54.8510, lng:-5.8240, by:'Larne Local', votes:0, photo:null, price:null, spaces:55, premium:true },
  { id:730, name:'Larne Town Park Car Park', near:'Larne Town Park & Chaine Park', tags:['larne','town park','chaine park','glenarm road','seafront','free parking'], badge:'free', dist:0, walk:'~10 min', restriction:'Free all day', notes:'Free parking beside Larne Town Park and Chaine Park accessed from Old Glenarm Road. Popular with walkers, cyclists and families visiting the seafront promenade.', lat:54.8568, lng:-5.8082, by:'Official', votes:0, photo:null, price:null, spaces:40 },
];

// ── Enniskillen ───────────────────────────────────────────────────────────────
const ENNISKILLEN_SPOTS = [
  { id:751, name:'Erneside Shopping Centre Car Park', near:'Erneside Shopping Centre', tags:['enniskillen','erneside','shopping centre','town centre','multi-storey'], badge:'official', dist:0, walk:'Right there', restriction:'Shopping centre hours Mon-Sat 9am-6pm', notes:'Main multi-storey in Enniskillen with 600 spaces attached to Erneside Shopping Centre. Well-lit, covered and the most central option for town centre shopping.', lat:54.3432, lng:-7.6358, by:'Official', votes:0, photo:null, price:'Free with validation / £1/hr without', spaces:600 },
  { id:752, name:'Cross Street Car Park', near:'Enniskillen town centre', tags:['enniskillen','cross street','town centre','pay and display','ev charging'], badge:'official', dist:0, walk:'~3 min', restriction:'Pay & Display Mon-Sat 8am-6pm', notes:'Council Pay & Display close to the town centre core. Has EV charging and uses RingGo cashless payment. Affordable at 40p/hr.', lat:54.3448, lng:-7.6372, by:'Official', votes:0, photo:null, price:'40p/hr', spaces:80 },
  { id:753, name:'Eden Street Car Park', near:'Enniskillen Bus Station', tags:['enniskillen','eden street','town centre','ev charging','bus station'], badge:'official', dist:0, walk:'~4 min', restriction:'Pay & Display Mon-Sat 8am-6pm', notes:'Council Pay & Display just off the town centre near the bus station on Eden Street. Has EV charging — handy if you need to top up while you shop. Accepts RingGo.', lat:54.3441, lng:-7.6343, by:'Official', votes:0, photo:null, price:'40p/hr', spaces:100 },
  { id:754, name:'Shore Road East Car Park', near:'Lough Erne / Enniskillen Castle', tags:['enniskillen','shore road','lough erne','castle','waterfront'], badge:'official', dist:0, walk:'~5 min', restriction:'Pay & Display Mon-Sat 8am-6pm', notes:'Surface car park on Shore Road beside Lough Erne with lovely waterfront views. Close to Enniskillen Castle. Very reasonable at 40p for 3 hours.', lat:54.3412, lng:-7.6441, by:'Official', votes:0, photo:null, price:'40p/3hrs', spaces:120 },
  { id:755, name:'East Bridge Street On-Street', near:'Enniskillen town centre / Paget Square', tags:['enniskillen','east bridge street','on-street','town centre','timed'], badge:'timed', dist:0, walk:'~2 min', restriction:'1hr limit Mon-Sat 8am-7pm, no return within 2hrs', notes:'On-street bays right at the edge of the town centre. Free after 7pm and all day Sunday.', lat:54.3455, lng:-7.6350, by:'Enniskillen Local', votes:0, photo:null, price:null, spaces:12 },
  { id:756, name:'Townhall Street On-Street', near:'Enniskillen Town Hall / High Street', tags:['enniskillen','townhall street','high street','on-street','timed'], badge:'timed', dist:0, walk:'~2 min', restriction:'1hr limit Mon-Sat 8am-7pm, no return within 2hrs', notes:'On-street parking bays on Townhall Street in the commercial heart of Enniskillen. Handy for High Street shops. Free evenings and Sundays from 7pm.', lat:54.3451, lng:-7.6388, by:'Enniskillen Local', votes:0, photo:null, price:null, spaces:10 },
  { id:757, name:'Station Green Car Park', near:'Enniskillen town centre', tags:['enniskillen','station green','free parking','town centre'], badge:'free', dist:0, walk:'~6 min', restriction:'Free all day', notes:'Free surface car park at Station Green, short walk from the town centre. One of the councils free off-street car parks — no charge, no time limit. Perfect for longer stays.', lat:54.3468, lng:-7.6330, by:'Enniskillen Local', votes:0, photo:null, price:null, spaces:60 },
  { id:758, name:'Shore Road West Car Park', near:'Lough Erne waterfront / Enniskillen Boat Club', tags:['enniskillen','shore road west','lough erne','waterfront','free','boat club'], badge:'free', dist:0, walk:'~8 min', restriction:'Free all day', notes:'Free surface car park on the western end of Shore Road beside Lough Erne. Popular with walkers, anglers and visitors to the waterfront.', lat:54.3402, lng:-7.6498, by:'Enniskillen Local', votes:0, photo:null, price:null, spaces:50 },
  { id:759, name:'Hollyhill Link Road Car Park', near:'Forthill Park / Enniskillen town centre', tags:['enniskillen','hollyhill','forthill','free parking','hidden gem'], badge:'hidden_gem', dist:0, walk:'~7 min', restriction:'Free all day', notes:"A genuine local secret — free car park off Hollyhill Link Road on the edge of Forthill Park. Described locally as 'one of the few free facilities close to town'. Most visitors never find it.", lat:54.3478, lng:-7.6410, by:'Enniskillen Local', votes:0, photo:null, price:null, spaces:40, premium:true },
  { id:760, name:'Wellington Road Overflow Lay-By', near:'Fermanagh House / Enniskillen town centre', tags:['enniskillen','wellington road','free parking','hidden gem','lay-by'], badge:'hidden_gem', dist:0, walk:'~5 min', restriction:'Free, no marked restrictions', notes:'Little-known line of free lay-by parking spaces on Wellington Road near Fermanagh House. No ticket needed, unmetered, short walk from the High Street. Goes quickly on market days.', lat:54.3461, lng:-7.6415, by:'Enniskillen Local', votes:0, photo:null, price:null, spaces:15, premium:true },
];

// ── Omagh ─────────────────────────────────────────────────────────────────────
const OMAGH_SPOTS = [
  { id:781, name:'Johnston Park Car Park', near:'Omagh Town Centre', tags:['omagh','johnston park','town centre','pay and display','council'], badge:'official', dist:0, walk:'~3 min', restriction:'Pay & Display, Mon-Sat 8am-6pm', notes:'Largest council car park in Omagh with 195 spaces — centrally located and the go-to for town centre shopping. Pay via cash or RingGo app. Gets busy on Saturdays.', lat:54.5971, lng:-7.2985, by:'Official', votes:0, photo:null, price:'£0.40/hr', spaces:195 },
  { id:782, name:'New Brighton Terrace Car Park', near:'Omagh Town Centre / High Street', tags:['omagh','new brighton terrace','town centre','pay and display'], badge:'official', dist:0, walk:'~4 min', restriction:'Pay & Display, Mon-Sat 8am-6pm', notes:'Popular 95-space council Pay & Display close to the High Street and Market Street shops. One of the busiest in Omagh — arrive early on market days.', lat:54.5958, lng:-7.2975, by:'Official', votes:0, photo:null, price:'£0.40/hr', spaces:95 },
  { id:783, name:'Drumragh Avenue Car Park', near:'Drumragh Avenue / Omagh town centre', tags:['omagh','drumragh avenue','town centre','pay and display'], badge:'official', dist:0, walk:'~5 min', restriction:'Pay & Display, Mon-Sat 8am-6pm', notes:'Large 139-space council car park off Drumragh Avenue, well placed for the western side of town. Regularly fills above 85% occupancy during peak hours.', lat:54.5978, lng:-7.3025, by:'Official', votes:0, photo:null, price:'£0.40/hr', spaces:139 },
  { id:784, name:'Foundry Lane Car Park', near:'High Street / Omagh town centre', tags:['omagh','foundry lane','high street','town centre','pay and display'], badge:'official', dist:0, walk:'~2 min', restriction:'Pay & Display, Mon-Sat 8am-6pm', notes:'Handy council Pay & Display on Foundry Lane just off the High Street — ideal for quick trips to the town centre shops.', lat:54.5965, lng:-7.2955, by:'Official', votes:0, photo:null, price:'£0.40/hr', spaces:null },
  { id:785, name:'Showgrounds Retail Park (Free)', near:'Showgrounds Retail Park / Sedan Avenue', tags:['omagh','showgrounds','sedan avenue','retail park','free','marks and spencer'], badge:'free', dist:0, walk:'Right there', restriction:'Free while shopping', notes:'Large open-air car park with 325 free spaces serving the Showgrounds Retail Park on Sedan Avenue. Home to M&S, Next and other major retailers. Always free.', lat:54.5948, lng:-7.2870, by:'Omagh Local', votes:0, photo:null, price:null, spaces:325 },
  { id:786, name:'Asda Omagh (Dromore Road)', near:'Asda Superstore / Dromore Road', tags:['omagh','asda','dromore road','superstore','free','supermarket'], badge:'free', dist:0, walk:'Right there', restriction:'Free for Asda customers', notes:'Free customer car park at Asda Omagh on Dromore Road. Ample spaces, open during store hours. Useful overflow when town centre car parks are full on busy Saturdays.', lat:54.5932, lng:-7.2905, by:'Omagh Local', votes:0, photo:null, price:null, spaces:null },
  { id:787, name:'Castle Street On-Street Parking', near:'Strule Arts Centre / Castle Street', tags:['omagh','castle street','strule arts centre','on-street','timed'], badge:'timed', dist:0, walk:'~2 min', restriction:'Mon-Sat 8am-6pm limited; free evenings & Sundays', notes:'On-street spaces on Castle Street beside the Strule Arts Centre. Perfect for theatre visits in the evenings when parking is free.', lat:54.5960, lng:-7.2968, by:'Omagh Local', votes:0, photo:null, price:null, spaces:null },
  { id:788, name:'Church Street North On-Street', near:'Church Street / Omagh town centre', tags:['omagh','church street','on-street','timed','town centre'], badge:'timed', dist:0, walk:'~3 min', restriction:'Mon-Sat 8am-6pm limited; free evenings & Sundays', notes:'On-street spaces on Church Street North within easy reach of the Market Street shopping area. Free in the evenings — good for a meal out.', lat:54.5970, lng:-7.2960, by:'Omagh Local', votes:0, photo:null, price:null, spaces:null },
  { id:789, name:'Omagh Riverside Walk Lay-By', near:'River Strule / Omagh Riverside Walk', tags:['omagh','riverside','river strule','hidden gem','free','abbey bridge'], badge:'hidden_gem', dist:0, walk:'Right there', restriction:'Free all day, no restrictions', notes:"Quiet lay-by alongside the River Strule used by locals visiting the Riverside Walk. Virtually unknown to visitors and completely free — walk straight onto the riverside path.", lat:54.5940, lng:-7.2940, by:'Omagh Local', votes:0, photo:null, price:null, spaces:null, premium:false },
  { id:790, name:'Campsie Road Quiet Street Parking', near:'Campsie Road / west Omagh', tags:['omagh','campsie road','free','hidden gem','residential'], badge:'hidden_gem', dist:0, walk:'~8 min', restriction:'Free all day', notes:'Residential street on the western edge of the town centre where locals park for free and walk in. Zero charge, zero hassle, ~8 minutes on foot to the High Street.', lat:54.5985, lng:-7.3055, by:'Omagh Local', votes:0, photo:null, price:null, spaces:null, premium:true },
];

// ── Dungannon ─────────────────────────────────────────────────────────────────
const DUNGANNON_SPOTS = [
  { id:811, name:'Scotch Street South Car Park', near:'Dungannon Town Centre', tags:['dungannon','scotch street','town centre','ev charging','official'], badge:'official', dist:0, walk:'~2 min', restriction:'Mon-Sat 8am-6pm, charges apply', notes:'Main off-street car park in the heart of Dungannon town centre, off Scotch Street. Has an EcarNI EV charging point.', lat:54.5028, lng:-6.7695, by:'Official', votes:0, photo:null, price:'Pay & Display', spaces:null },
  { id:812, name:'Scotch Street North Car Park', near:'Scotch Street shops / Dungannon', tags:['dungannon','scotch street','town centre','north'], badge:'official', dist:0, walk:'~2 min', restriction:'Mon-Sat 8am-6pm, charges apply', notes:'Second off-street car park serving the northern end of Scotch Street. Convenient for the upper town shopping area and quick access to Market Square.', lat:54.5039, lng:-6.7708, by:'Official', votes:0, photo:null, price:'Pay & Display', spaces:null },
  { id:813, name:'Perry Street East Car Park', near:'Dungannon Town Centre / Ranfurly House', tags:['dungannon','perry street','town centre','council'], badge:'official', dist:0, walk:'~3 min', restriction:'Mon-Sat, charges apply', notes:'Large surface car park off Perry Street with 92 spaces — one of the biggest off-street options in Dungannon. Good for longer stays.', lat:54.5020, lng:-6.7680, by:'Official', votes:0, photo:null, price:'Pay & Display', spaces:92 },
  { id:814, name:'Market Square On-Street', near:'Dungannon Market Square / Ranfurly House Arts Centre', tags:['dungannon','market square','town centre','timed','on-street'], badge:'timed', dist:0, walk:'Right there', restriction:'1hr max Mon-Sat 8:15am-6:15pm (no return 1hr)', notes:'On-street spaces right on Market Square, the historic heart of Dungannon. Perfect for a quick visit to Ranfurly House Arts Centre.', lat:54.5033, lng:-6.7693, by:'Dungannon Local', votes:0, photo:null, price:null, spaces:null },
  { id:815, name:'Church Street On-Street', near:'Dungannon town centre / Castle Hill', tags:['dungannon','church street','town centre','timed','on-street'], badge:'timed', dist:0, walk:'~2 min', restriction:'1hr max Mon-Sat 8:15am-6:15pm, free evenings & Sundays', notes:'On-street timed parking on Church Street, short walk from the main shopping streets. Free after 6:15pm and all day Sunday.', lat:54.5042, lng:-6.7700, by:'Dungannon Local', votes:0, photo:null, price:null, spaces:null },
  { id:816, name:'Northland Row On-Street', near:'Dungannon town centre / Thomas Street', tags:['dungannon','northland row','on-street','free','town centre'], badge:'free', dist:0, walk:'~4 min', restriction:'Side spaces free, no restrictions', notes:'Northland Row runs along the eastern edge of the town centre. Side streets off here offer free unrestricted parking just a short walk from the main shopping area.', lat:54.5038, lng:-6.7672, by:'Dungannon Local', votes:0, photo:null, price:null, spaces:null },
  { id:817, name:'Shamble Lane On-Street', near:'Dungannon town centre / Scotch Street', tags:['dungannon','shamble lane','on-street','free','hidden gem'], badge:'hidden_gem', dist:0, walk:'~3 min', restriction:'Free, no restrictions', notes:'Tucked just off Scotch Street, Shamble Lane is a quiet back street most visitors overlook entirely. Locals use it when main car parks are full — especially handy on market day Thursdays.', lat:54.5031, lng:-6.7712, by:'Dungannon Local', votes:0, photo:null, price:null, spaces:null, premium:true },
  { id:818, name:'Dungannon Leisure Centre Car Park', near:'Dungannon Leisure Centre / Circular Road', tags:['dungannon','leisure centre','circular road','free'], badge:'free', dist:0, walk:'~8 min', restriction:'Free all day', notes:'Large free car park at Dungannon Leisure Centre on Circular Road — a well-known overflow option for town centre visitors. Short walk in, completely free, no time limit.', lat:54.5058, lng:-6.7648, by:'Dungannon Local', votes:0, photo:null, price:null, spaces:null },
  { id:819, name:'Irish Street On-Street', near:'Dungannon town centre / Thomas Street', tags:['dungannon','irish street','on-street','timed','town centre'], badge:'timed', dist:0, walk:'~3 min', restriction:'1hr max Mon-Sat 8:15am-6:15pm, free all other times', notes:'On-street spaces on Irish Street, one of the principal historic streets. Free parking after 6:15pm makes it ideal for evening visits to local restaurants.', lat:54.5025, lng:-6.7700, by:'Dungannon Local', votes:0, photo:null, price:null, spaces:null },
  { id:820, name:"Hill of the O'Neill Car Park", near:"Hill of the O'Neill / Castle Hill heritage site", tags:['dungannon','hill of the oneill','castle hill','heritage','free','hidden gem'], badge:'hidden_gem', dist:0, walk:'~5 min', restriction:'Free all day', notes:"A little-known free parking area at the base of Castle Hill, beside the Hill of the O'Neill heritage site. Almost always quiet — short downhill walk to the town centre.", lat:54.5050, lng:-6.7660, by:'Dungannon Local', votes:0, photo:null, price:null, spaces:null, premium:true },
];

// ── Cookstown ─────────────────────────────────────────────────────────────────
const COOKSTOWN_SPOTS = [
  { id:841, name:'Burn Road Car Park', near:'Burnavon Arts and Cultural Centre', tags:['cookstown','burn road','burnavon','town centre','paid'], badge:'official', dist:0, walk:'~2 min', restriction:'Mon-Sat charges apply; check on-site signage', notes:'Main town centre surface car park off Burn Road, close to Home Bargains and the Burnavon. Charges apply during the week.', lat:54.6469, lng:-6.7479, by:'Official', votes:0, photo:null, price:'£1.00/hr', spaces:120 },
  { id:842, name:'Burnavon Free Car Park', near:'Burnavon Arts and Cultural Centre', tags:['cookstown','burnavon','burn road','free parking','arts centre'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day', notes:'Free public surface car park adjacent to the Burnavon Arts and Cultural Centre on Burn Road. Very convenient for the town centre and always a solid free option.', lat:54.6462, lng:-6.7468, by:'Cookstown Local', votes:0, photo:null, price:null, spaces:60 },
  { id:843, name:'William Street On-Street', near:"Cookstown Main Street", tags:['cookstown','william street','main street','on-street','timed'], badge:'timed', dist:0, walk:'~1 min', restriction:'Mon-Sat 9am-6pm; free evenings & Sundays', notes:"On-street bays along William Street, part of Cookstown's famous mile-long Main Street. Time-limited during the day, free outside those hours.", lat:54.6448, lng:-6.7452, by:'Cookstown Local', votes:0, photo:null, price:null, spaces:20 },
  { id:844, name:'James Street On-Street', near:'Cookstown Town Hall', tags:['cookstown','james street','town hall','main street','on-street','timed'], badge:'timed', dist:0, walk:'~2 min', restriction:'Mon-Sat 9am-6pm; free evenings & Sundays', notes:'Authorised parking bays on James Street along the southern stretch of the Main Street near the Town Hall. Free after 6pm and on Sundays.', lat:54.6437, lng:-6.7438, by:'Cookstown Local', votes:0, photo:null, price:null, spaces:18 },
  { id:845, name:'Oldtown Street On-Street', near:'SuperValu Cookstown', tags:['cookstown','oldtown street','supervalu','main street','on-street','free'], badge:'free', dist:0, walk:'~1 min', restriction:'Free all day', notes:'On-street spaces on Oldtown Street near the SuperValu. Good shout for quick errands on the lower end of the Main Street. Usually has availability mid-morning.', lat:54.6432, lng:-6.7435, by:'Cookstown Local', votes:0, photo:null, price:null, spaces:15 },
  { id:846, name:'Asda Cookstown Car Park', near:'Asda Cookstown Superstore', tags:['cookstown','asda','sweep road','supermarket','free parking'], badge:'free', dist:0, walk:'Right there', restriction:'Free; customers only during store hours', notes:'Large free car park at Asda Superstore on Sweep Road. Reliable option even when the town centre is busy.', lat:54.6414, lng:-6.7411, by:'Official', votes:0, photo:null, price:null, spaces:200 },
  { id:847, name:'Tesco Cookstown Car Park', near:'Tesco Superstore Cookstown', tags:['cookstown','tesco','orritor road','supermarket','free parking'], badge:'free', dist:0, walk:'Right there', restriction:'Free; time limit applies for customers', notes:'Free car park at the Tesco Superstore on Orritor Road. Many locals use it as a base to walk into the town centre.', lat:54.6422, lng:-6.7388, by:'Official', votes:0, photo:null, price:null, spaces:180 },
  { id:848, name:'Loy Street Side Streets', near:"Cookstown Main Street (Loy Street)", tags:['cookstown','loy street','main street','hidden gem','side street','free'], badge:'hidden_gem', dist:0, walk:'~3 min', restriction:'Free all day', notes:'Network of side streets feeding off Loy Street offers free unmarked parking most visitors drive straight past. Locals know these quiet residential pockets as the best free option near everything on the Main Street.', lat:54.6455, lng:-6.7460, by:'Cookstown Local', votes:0, photo:null, price:null, spaces:12, premium:true },
  { id:849, name:'Chapel Street Quiet Bays', near:'Holy Trinity Catholic Church / Cookstown', tags:['cookstown','chapel street','church street','hidden gem','free parking','main street'], badge:'hidden_gem', dist:0, walk:'~2 min', restriction:'Free all day; busier Sunday mornings', notes:'A stretch of underused on-street bays on Chapel Street near Holy Trinity Church — right in the heart of the Main Street but overlooked by most. Completely free, zero hassle.', lat:54.6441, lng:-6.7447, by:'Cookstown Local', votes:0, photo:null, price:null, spaces:10, premium:true },
  { id:850, name:'Molesworth Street On-Street', near:'Cookstown Town Centre (North End)', tags:['cookstown','molesworth street','town centre','on-street','timed'], badge:'timed', dist:0, walk:'~4 min', restriction:'No waiting Mon-Sat 9am-6pm on some lengths; bays available nearby', notes:'Molesworth Street has a mix of waiting restrictions and authorised parking bays at the northern approach to town. Check signage carefully. Free outside Mon-Sat daytime hours.', lat:54.6480, lng:-6.7470, by:'Cookstown Local', votes:0, photo:null, price:null, spaces:14 },
];

// ── Strabane ──────────────────────────────────────────────────────────────────
const STRABANE_SPOTS = [
  { id:861, name:'Lower Main Street North Car Park', near:"Strabane Town Centre / Gray's Printing Press", tags:['strabane','main street','town centre','grays printing press','pay display','council'], badge:'official', dist:0, walk:'Right there', restriction:'Mon-Sat 8am-6pm, charges apply', notes:"Council Pay & Display right in the heart of Strabane, steps from Main Street shops and Gray's Printing Press. RingGo app accepted.", lat:54.8268, lng:-7.4631, by:'Official', votes:0, photo:null, price:'£1.00/hr', spaces:80 },
  { id:862, name:'Upper Main Street Car Park', near:'Strabane Retail Park / Upper Town Centre', tags:['strabane','main street','upper main street','retail','pay display'], badge:'official', dist:0, walk:'~2 min', restriction:'Mon-Sat 8am-6pm, charges apply', notes:'Derry City & Strabane Council Pay & Display serving the upper end of Main Street and nearby retail. RingGo cashless payment available.', lat:54.8282, lng:-7.4648, by:'Official', votes:0, photo:null, price:'£1.00/hr', spaces:100 },
  { id:863, name:'Railway Street Car Park', near:'Strabane Town Centre / Abercorn Square', tags:['strabane','railway street','town centre','abercorn square','pay display'], badge:'official', dist:0, walk:'~3 min', restriction:'Mon-Sat 8am-6pm, charges apply', notes:'Council Pay & Display off Railway Street, short walk from Abercorn Square and the main shopping streets.', lat:54.8272, lng:-7.4622, by:'Official', votes:0, photo:null, price:'£1.00/hr', spaces:60 },
  { id:864, name:'Canal Basin Car Park', near:'Canal Basin / River Mourne', tags:['strabane','canal basin','dock street','canal street','river mourne','free'], badge:'free', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Free surface car park at the Canal Basin on Dock Street near the River Mourne. Slightly further from Main Street but worth the short walk to avoid charges.', lat:54.8255, lng:-7.4600, by:'Strabane Local', votes:0, photo:null, price:null, spaces:50 },
  { id:865, name:'Butcher Street Car Park', near:'Strabane Town Centre / Church Street', tags:['strabane','butcher street','church street','town centre','free'], badge:'free', dist:0, walk:'~3 min', restriction:'Free all day', notes:'Compact free surface car park tucked off Butcher Street. Handy for accessing the town centre without paying. Fills up quickly on busy shopping days.', lat:54.8278, lng:-7.4655, by:'Strabane Local', votes:0, photo:null, price:null, spaces:30 },
  { id:866, name:'ASDA Branch Road Car Park', near:'ASDA Strabane Superstore', tags:['strabane','asda','branch road','superstore','supermarket','free'], badge:'free', dist:0, walk:'~8 min', restriction:'Free up to 3 hrs for customers', notes:'Large well-lit free car park at ASDA Strabane on Branch Road with generous 3-hour limit. Easy to combine a shop with a town centre visit. Rarely full.', lat:54.8308, lng:-7.4711, by:'Strabane Local', votes:0, photo:null, price:null, spaces:250 },
  { id:867, name:'Meetinghouse Street On-Street', near:'Strabane Town Centre / Upper Main Street', tags:['strabane','meetinghouse street','on-street','town centre','timed'], badge:'timed', dist:0, walk:'~2 min', restriction:'Mon-Sat 8am-6pm, 1hr limit; free evenings & Sundays', notes:'On-street parking bays on Meetinghouse Street, quiet side street just off the upper town centre. Free after hours and all day Sunday.', lat:54.8276, lng:-7.4641, by:'Strabane Local', votes:0, photo:null, price:null, spaces:12 },
  { id:868, name:'Castle Street On-Street', near:'Strabane Town Centre / Abercorn Square', tags:['strabane','castle street','abercorn square','on-street','timed'], badge:'timed', dist:0, walk:'~4 min', restriction:'Mon-Sat 8am-6pm, 1hr limit; free evenings & Sundays', notes:'Convenient on-street spaces on Castle Street close to Abercorn Square. Often overlooked in favour of the main car parks — handy option during quieter parts of the day.', lat:54.8265, lng:-7.4644, by:'Strabane Local', votes:0, photo:null, price:null, spaces:10 },
  { id:869, name:'Dock Street Riverside Layby', near:'Canal Basin / River Mourne Towpath', tags:['strabane','dock street','canal basin','river mourne','towpath','hidden gem','free'], badge:'hidden_gem', dist:0, walk:'~6 min', restriction:'Free all day', notes:'Informal layby on Dock Street alongside the River Mourne towpath — almost entirely unknown to visitors. Perfect for reaching the Canal Basin and riverside walks.', lat:54.8248, lng:-7.4592, by:'Strabane Local', votes:0, photo:null, price:null, spaces:15, premium:false },
  { id:870, name:'Strabane Retail Park Overflow', near:'Strabane Retail Park / Upper Main Street', tags:['strabane','retail park','overflow','upper main street','hidden gem','free'], badge:'hidden_gem', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Outer overflow section of Strabane Retail Park — largely unmarked and almost always empty. Short walk from the upper town centre. Only locals in the know use this area.', lat:54.8290, lng:-7.4668, by:'Strabane Local', votes:0, photo:null, price:null, spaces:20, premium:false },
];

// ── Downpatrick ───────────────────────────────────────────────────────────────
const DOWNPATRICK_SPOTS = [
  { id:881, name:'Irish Street Car Park', near:'Downpatrick Town Centre', tags:['downpatrick','irish street','town centre','pay and display'], badge:'official', dist:0, walk:'2 min', restriction:'Mon-Sat 8:30am-6:30pm (50p/hr)', notes:'Largest council Pay & Display in Downpatrick with 85 spaces. Pay by coin or RingGo app. Free evenings and Sundays.', lat:54.3243, lng:-5.7168, by:'Official', votes:0, photo:null, price:'50p/hr', spaces:85 },
  { id:882, name:'Scotch Street Car Park', near:'Downpatrick Town Centre / Saul Street', tags:['downpatrick','scotch street','saul street','town centre','pay and display'], badge:'official', dist:0, walk:'2 min', restriction:'Mon-Sat 8:30am-6:30pm (50p/hr)', notes:'Council Pay & Display off Scotch Street with 36 spaces, handy for the town shops and pubs. Pay by coin or RingGo.', lat:54.3231, lng:-5.7175, by:'Official', votes:0, photo:null, price:'50p/hr', spaces:36 },
  { id:883, name:'Church Street Car Park', near:"St Patrick's Centre / Market Street", tags:['downpatrick','church street','market street','st patricks centre','pay and display'], badge:'official', dist:0, walk:'3 min', restriction:'Mon-Sat 8:30am-6:30pm (50p/hr)', notes:"Compact 27-space council car park off Church Street, close to Market Street shops and the St Patrick Centre visitor area. Quieter than Irish Street.", lat:54.3220, lng:-5.7148, by:'Official', votes:0, photo:null, price:'50p/hr', spaces:27 },
  { id:884, name:'Saint Patrick Centre Car Park', near:"Saint Patrick Centre / Market Street", tags:['downpatrick','saint patrick centre','market street','visitor car park'], badge:'paid', dist:0, walk:'Right there', restriction:'During opening hours, charges apply', notes:"Large Pay & Display in front of the Saint Patrick Centre with over 100 spaces. Main visitor car park for Down Cathedral and Down County Museum.", lat:54.3213, lng:-5.7142, by:'Official', votes:0, photo:null, price:'£1/hr', spaces:110 },
  { id:885, name:'English Street On-Street Parking', near:'Down Cathedral / Down County Museum', tags:['downpatrick','english street','down cathedral','down county museum','on-street','timed'], badge:'timed', dist:0, walk:'1 min', restriction:'Mon-Sat 8am-6pm limited; free evenings & Sundays', notes:'On-street bays along English Street directly outside Down County Museum and close to Down Cathedral. Great free option on Sundays.', lat:54.3235, lng:-5.7155, by:'Downpatrick Local', votes:0, photo:null, price:null, spaces:null },
  { id:886, name:'Market Street On-Street Bays', near:'Market Street Shops / Town Centre', tags:['downpatrick','market street','town centre','shopping','on-street','timed'], badge:'timed', dist:0, walk:'Right there', restriction:'Mon-Sat 8am-6pm, 1-hr limit; free evenings & Sundays', notes:'On-street parking bays along Market Street in the commercial heart of Downpatrick. Busy on market days — arrive early.', lat:54.3218, lng:-5.7150, by:'Downpatrick Local', votes:0, photo:null, price:null, spaces:null },
  { id:887, name:'Barrack Street Free Parking', near:'Downpatrick Town Centre (south approach)', tags:['downpatrick','barrack street','free parking','town centre','on-street'], badge:'free', dist:0, walk:'5 min', restriction:'Free all day', notes:'Free on-street parking along Barrack Street on the southern edge of the town centre. Largely overlooked by visitors but only a short walk to the shops and Cathedral.', lat:54.3208, lng:-5.7162, by:'Downpatrick Local', votes:0, photo:null, price:null, spaces:null },
  { id:888, name:'Stream Street Free Parking', near:'Downpatrick Town Centre (east side)', tags:['downpatrick','stream street','free parking','on-street','quiet'], badge:'free', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Quiet residential street on the east side of the town centre with unrestricted free parking. Short walk to Market Street and Church Street.', lat:54.3224, lng:-5.7120, by:'Downpatrick Local', votes:0, photo:null, price:null, spaces:null },
  { id:889, name:"The Mall / Cathedral Hill Lay-by", near:"Down Cathedral / St Patrick's Grave", tags:['downpatrick','the mall','cathedral hill','down cathedral','st patricks grave','hidden gem','free'], badge:'hidden_gem', dist:0, walk:'Right there', restriction:'Free all day', notes:"Small informal lay-by at the top of the Mall on Cathedral Hill. Puts you right at the entrance to St Patrick's Grave without any charge. Often missed by visitors who head to the paid Market Street car park.", lat:54.3250, lng:-5.7143, by:'Downpatrick Local', votes:0, photo:null, price:null, spaces:null, premium:true },
  { id:890, name:'John Street Overflow Parking', near:'Downpatrick Town Centre / Irish Street', tags:['downpatrick','john street','free parking','hidden gem','locals only','overflow'], badge:'hidden_gem', dist:0, walk:'~4 min', restriction:'Free all day', notes:'Tucked-away side street running off Irish Street that locals use as overflow when main car parks are full. Completely free, unrestricted, easy walking distance to Market Street.', lat:54.3248, lng:-5.7181, by:'Downpatrick Local', votes:0, photo:null, price:null, spaces:null, premium:true },
];

// ── Newcastle ─────────────────────────────────────────────────────────────────
const NEWCASTLE_SPOTS = [
  { id:911, name:'Donard Car Park', near:'Donard Park & Slieve Donard', tags:['newcastle','donard','donard park','slieve donard','promenade','mourne mountains','beach'], badge:'free', dist:0, walk:'~3 min', restriction:'Free, max 12 hrs', notes:'Main large car park at Donard Park with 215 spaces and EV charging. Perfect base for hitting the beach, promenade and the start of the Slieve Donard mountain trail.', lat:54.2060, lng:-5.8942, by:'Official', votes:0, photo:null, price:null, spaces:215 },
  { id:912, name:'Downs Road Car Park', near:'Slieve Donard Hotel & Newcastle Beach', tags:['newcastle','downs road','slieve donard hotel','beach','promenade','seafront'], badge:'free', dist:0, walk:'~2 min', restriction:'Free, max 12 hrs', notes:'Largest free car park in Newcastle with 225 spaces right beside the Slieve Donard Hotel and steps from the beach. Gets very busy on summer weekends — arrive early.', lat:54.2158, lng:-5.8849, by:'Official', votes:0, photo:null, price:null, spaces:225 },
  { id:913, name:'Shimna Road Car Park', near:'Newcastle Bus Station & Town Centre', tags:['newcastle','shimna road','bus station','town centre','shimna river'], badge:'free', dist:0, walk:'~5 min', restriction:'Free, max 12 hrs', notes:'Handy free car park off Shimna Road close to Newcastle Bus Station and town centre shops. 53 spaces with disabled facilities. Quieter than the beach car parks.', lat:54.2153, lng:-5.8907, by:'Official', votes:0, photo:null, price:null, spaces:53 },
  { id:914, name:'Tesco Castlewellan Road Car Park', near:'Tesco Superstore Newcastle', tags:['newcastle','tesco','castlewellan road','supermarket','shopping'], badge:'free', dist:0, walk:'~8 min', restriction:'Free for customers (time limited)', notes:'Large surface car park at Tesco on Castlewellan Road. 10 Blue Badge bays and parent-and-child spaces. Free for shoppers.', lat:54.2205, lng:-5.9012, by:'Newcastle Local', votes:0, photo:null, price:null, spaces:120 },
  { id:915, name:'Main Street On-Street Parking', near:'Newcastle Town Centre Shops', tags:['newcastle','main street','town centre','shopping','high street'], badge:'timed', dist:0, walk:'Right there', restriction:'Mon-Sat, limited stay daytime', notes:'On-street bays along the newly upgraded Newcastle Main Street. Short-stay for quick errands — free in evenings and Sundays.', lat:54.2178, lng:-5.8960, by:'Newcastle Local', votes:0, photo:null, price:null, spaces:null },
  { id:916, name:'Central Promenade On-Street Bays', near:'Newcastle Centre & Tropicana Pool', tags:['newcastle','central promenade','promenade','seafront','tropicana'], badge:'timed', dist:0, walk:'Right there', restriction:'Mon-Sat daytime limited stay', notes:'On-street parking along Central Promenade facing the beach, near Newcastle Centre and the Tropicana outdoor pool. Very popular in summer — arrive before 9am in July/August.', lat:54.2168, lng:-5.8920, by:'Newcastle Local', votes:0, photo:null, price:null, spaces:null },
  { id:917, name:'Bryansford Road On-Street Parking', near:'Tollymore Forest Park Road & Bryansford Village', tags:['newcastle','bryansford road','bryansford','tollymore','free parking'], badge:'free', dist:0, walk:'~10 min', restriction:'Free, no restrictions', notes:'Unrestricted free on-street parking on Bryansford Road heading toward Tollymore Forest Park. Useful when beach car parks are full.', lat:54.2230, lng:-5.9050, by:'Newcastle Local', votes:0, photo:null, price:null, spaces:null },
  { id:918, name:'Castlebridge Court Car Park', near:'Newcastle Town Centre (behind Main Street)', tags:['newcastle','castlebridge court','hidden gem','free parking','town centre'], badge:'hidden_gem', dist:0, walk:'~4 min', restriction:'Free daytime, no overnight', notes:'Quiet lesser-known free car park tucked in at Castlebridge Court. Locals use it to avoid the busy seafront car parks. No overnight parking.', lat:54.2103, lng:-5.8917, by:'Newcastle Local', votes:0, photo:null, price:null, spaces:30, premium:true },
  { id:919, name:'Shimna Road Riverside Lay-By', near:'Shimna River Walk & Donard Forest', tags:['newcastle','shimna road','shimna river','donard forest','hidden gem','walkers'], badge:'hidden_gem', dist:0, walk:'~5 min', restriction:'Free, no restrictions', notes:'Free informal lay-by spaces along Shimna Road near the river and forest edge. Popular with walkers heading into Donard Forest who want to avoid the busier car park.', lat:54.2128, lng:-5.8935, by:'Newcastle Local', votes:0, photo:null, price:null, spaces:10, premium:false },
];

// ── Portadown ─────────────────────────────────────────────────────────────────
const PORTADOWN_SPOTS = [
  { id:931, name:'High Street Mall Multi-Storey', near:'High Street Mall / Portadown Train Station', tags:['portadown','high street mall','northway','town centre','shopping','train station'], badge:'free', dist:0, walk:'Right there', restriction:'Free, open during mall hours', notes:'Over 500 free spaces in the multi-storey off the A3 Northway. Directly opposite Portadown bus and train station — ideal for shoppers and commuters alike.', lat:54.4257, lng:-6.4438, by:'Official', votes:0, photo:null, price:null, spaces:500 },
  { id:932, name:'Magowan Buildings Car Park', near:'West Street / Portadown Town Centre', tags:['portadown','magowan','west street','town centre','council','pay and display'], badge:'official', dist:0, walk:'2 min', restriction:'Mon-Sat 8am-6pm, Pay & Display', notes:'Council Pay & Display in the heart of Portadown town centre off West Street. Has EV charging. Pay via RingGo or coin machine.', lat:54.4275, lng:-6.4488, by:'Official', votes:0, photo:null, price:'£0.30/hr', spaces:120 },
  { id:933, name:'Marley Street Car Park', near:'Bridge Street / Portadown Town Centre', tags:['portadown','marley street','bridge street','town centre','council'], badge:'official', dist:0, walk:'3 min', restriction:'Mon-Sat 8am-6pm, Pay & Display', notes:'Small council car park (36 spaces) on Bridge Street. Handy for quick trips to the main commercial strip. Pay via RingGo or coin machine.', lat:54.4268, lng:-6.4478, by:'Official', votes:0, photo:null, price:'£0.30/hr', spaces:36 },
  { id:934, name:'Wilson Street Car Park', near:'Portadown Town Centre', tags:['portadown','wilson street','town centre','council'], badge:'official', dist:0, walk:'4 min', restriction:'Mon-Sat 8am-6pm, Pay & Display', notes:'Large council car park with 260 spaces just off the town centre. Reliable when central car parks are full, especially on busy market days.', lat:54.4282, lng:-6.4506, by:'Official', votes:0, photo:null, price:'£0.30/hr', spaces:260 },
  { id:935, name:'Fairgreen Car Park (Duke Street)', near:'Duke Street / Recycling Centre', tags:['portadown','fairgreen','duke street','shillington street','free parking','hidden gem'], badge:'free', dist:0, walk:'8 min', restriction:'Free all day', notes:'Large free council car park with 160 spaces off Duke Street beside the Council recycling centre. Little-known by visitors — a genuine free alternative when paid spots are full.', lat:54.4231, lng:-6.4523, by:'Portadown Local', votes:0, photo:null, price:null, spaces:160 },
  { id:936, name:"People's Park Car Park", near:"Portadown People's Park", tags:['portadown','peoples park','park','free parking','hidden gem'], badge:'hidden_gem', dist:0, walk:'~5 min', restriction:'Free all day', notes:"Free surface car park with 62 spaces at Portadown People's Park — a beautiful Victorian park close to the town centre. Virtually unknown to non-locals and nearly always has space.", lat:54.4292, lng:-6.4395, by:'Portadown Local', votes:0, photo:null, price:null, spaces:62, premium:true },
  { id:937, name:'Portadown Station Park & Ride', near:'Portadown Train Station / Northway', tags:['portadown','park and ride','train station','corcrain road','northway','commuter'], badge:'free', dist:0, walk:'2 min', restriction:'Free all day', notes:'Dedicated park and ride at Corcrain Road with 347 spaces, CCTV and covered cycle storage. Free for train commuters.', lat:54.4248, lng:-6.4425, by:'Official', votes:0, photo:null, price:null, spaces:347 },
  { id:938, name:'William Street Car Park', near:"St Patrick's RC Church", tags:['portadown','william street','st patricks','church','paid','pay and display'], badge:'paid', dist:0, walk:'5 min', restriction:'Mon-Sat 8am-6pm, Pay & Display', notes:"Pay & Display car park on William Street beside St Patrick's RC Church. Useful for accessing the western side of the town centre.", lat:54.4265, lng:-6.4516, by:'Portadown Local', votes:0, photo:null, price:'£0.30/hr', spaces:null },
  { id:939, name:'Church Street On-Street Parking', near:'Church Street / Town Centre', tags:['portadown','church street','on-street','timed','town centre'], badge:'timed', dist:0, walk:'Right there', restriction:'Mon-Sat 8am-6pm limited; free evenings & Sundays', notes:'On-street spaces along Church Street in the commercial core of Portadown. Free in evenings and all day Sunday.', lat:54.4279, lng:-6.4469, by:'Portadown Local', votes:0, photo:null, price:null, spaces:null },
  { id:940, name:'Shillington Street Lay-By', near:'Shillington Street / Fairgreen area', tags:['portadown','shillington street','on-street','free','hidden gem'], badge:'hidden_gem', dist:0, walk:'7 min', restriction:'Free all day', notes:'Quiet stretch of free on-street parking on Shillington Street that most visitors miss. Locals use it as overflow when the town centre is packed.', lat:54.4237, lng:-6.4510, by:'Portadown Local', votes:0, photo:null, price:null, spaces:null, premium:true },
];

// ── Craigavon ─────────────────────────────────────────────────────────────────
const CRAIGAVON_SPOTS = [
  { id:961, name:'Craigavon Civic Centre Car Park', near:'Craigavon Civic & Conference Centre', tags:['craigavon','civic centre','lakeview road','conference centre','council'], badge:'official', dist:0, walk:'Right there', restriction:'Open during civic centre hours', notes:'Large surface car park serving the Civic & Conference Centre on Lakeview Road. Pay & Display applies during business hours.', lat:54.4615, lng:-6.3490, by:'Official', votes:0, photo:null, price:'£1.00/hr', spaces:200 },
  { id:962, name:'South Lake Leisure Centre Car Park', near:'South Lake Leisure Centre & Craigavon City Park', tags:['craigavon','south lake','leisure centre','lake road','city park','watersports'], badge:'free', dist:0, walk:'Right there', restriction:'Free, open during leisure centre hours', notes:'Large free car park with over 300 spaces outside South Lake Leisure Centre on Lake Road. Well-lit, EV charging, disabled bays. Perfect base for the 3-mile lakes walk.', lat:54.4533, lng:-6.3612, by:'Official', votes:0, photo:null, price:null, spaces:300 },
  { id:963, name:'Tannaghmore Gardens Car Park', near:'Tannaghmore Gardens & Animal Farm', tags:['craigavon','tannaghmore','animal farm','gardens','family'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day', notes:'Free dedicated car park at Tannaghmore Gardens & Animal Farm. Two separate car parks — one next to the play park (with toilets) and one beside the animal farm.', lat:54.4665, lng:-6.3545, by:'Official', votes:0, photo:null, price:null, spaces:120 },
  { id:964, name:'Brownlow Community Hub Car Park', near:'Brownlow Community Hub', tags:['craigavon','brownlow','brownlow road','community hub'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day', notes:'Free car park at the front of Brownlow Community Hub on Brownlow Road. Central to the Craigavon new town area and rarely busy.', lat:54.4642, lng:-6.3378, by:'Craigavon Local', votes:0, photo:null, price:null, spaces:60 },
  { id:965, name:'Lakeview Road On-Street', near:'Craigavon Civic Centre', tags:['craigavon','lakeview road','on-street','civic centre','town centre'], badge:'timed', dist:0, walk:'~3 min', restriction:'Mon-Sat 8am-6pm, 1hr limit; free evenings & Sundays', notes:'On-street spaces along Lakeview Road beside the civic centre. Free on Sundays and after 6pm on weekdays.', lat:54.4622, lng:-6.3505, by:'Craigavon Local', votes:0, photo:null, price:null, spaces:20 },
  { id:966, name:'Brownlow Road On-Street', near:'Brownlow Community Hub', tags:['craigavon','brownlow road','on-street','free parking'], badge:'free', dist:0, walk:'~2 min', restriction:'Free all day, no restrictions', notes:'Unrestricted on-street parking on Brownlow Road in the heart of Craigavon new town. Locals use this as an alternative to the busier civic centre car park.', lat:54.4652, lng:-6.3395, by:'Craigavon Local', votes:0, photo:null, price:null, spaces:15 },
  { id:967, name:'Craigavon Watersports Centre Overflow Lay-by', near:'Craigavon City Park Lakes', tags:['craigavon','watersports','city park','lake road','hidden gem','lakes'], badge:'hidden_gem', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Unmarked lay-by parking along Lake Road just before the watersports centre entrance. Locals park here for free to access the 3-mile lakes loop when the main car park fills up.', lat:54.4543, lng:-6.3580, by:'Craigavon Local', votes:0, photo:null, price:null, spaces:10, premium:false },
  { id:968, name:'Legaghory Road Residential On-Street', near:'Craigavon New Town Centre', tags:['craigavon','legaghory','legaghory road','hidden gem','residential','free'], badge:'hidden_gem', dist:0, walk:'~6 min', restriction:'Free all day, no restrictions', notes:'Quiet residential side streets off Legaghory Road in the heart of Craigavon new town — completely unrestricted and almost always empty even on busy event days.', lat:54.4660, lng:-6.3430, by:'Craigavon Local', votes:0, photo:null, price:null, spaces:20, premium:true },
  { id:969, name:'Craigavon City Park North Car Park', near:'Craigavon City Park (North Lake)', tags:['craigavon','city park','north lake','lakes','park','walking'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day, dawn to dusk', notes:'Free surface car park at the northern end of Craigavon City Park giving direct access to the north lake walking trail. Less busy than the south lake car park.', lat:54.4675, lng:-6.3500, by:'Craigavon Local', votes:0, photo:null, price:null, spaces:80 },
];

// ── Ballycastle ───────────────────────────────────────────────────────────────
const BALLYCASTLE_SPOTS = [
  { id:991, name:'Ann Street Pay & Display Car Park', near:'Ballycastle Town Centre', tags:['ballycastle','ann street','town centre','pay and display'], badge:'official', dist:0, walk:'2 min', restriction:'Mon-Sat 8:30am-6:30pm, 30p/hr', notes:'Main town-centre car park managed by the council on Ann Street just off Castle Street. 97 spaces — best bet for visiting the shops or The Diamond.', lat:55.2038, lng:-6.2461, by:'Official', votes:0, photo:null, price:'30p/hr', spaces:97 },
  { id:992, name:'Castle Street Car Park', near:'Ballycastle Town Centre / The Diamond', tags:['ballycastle','castle street','town centre','the diamond','free'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day', notes:'Free council surface car park on Castle Street with 64 spaces. Very handy for The Diamond and the main row of traditional shops. Fills up fast in summer.', lat:55.2042, lng:-6.2472, by:'Ballycastle Local', votes:0, photo:null, price:null, spaces:64 },
  { id:993, name:'Ballycastle Harbour Car Park', near:'Ballycastle Harbour / Rathlin Island Ferry', tags:['ballycastle','harbour','ferry','rathlin island','seafront','free'], badge:'free', dist:0, walk:'Right there', restriction:'Free all day (seasonal charges under review)', notes:'Free car park right at the harbour, ideal for catching the Rathlin Island ferry. 61 spaces with great sea views.', lat:55.2015, lng:-6.2432, by:'Official', votes:0, photo:null, price:null, spaces:61 },
  { id:994, name:'Sheskburn House Car Park', near:'Ballycastle Seafront / Ballycastle Beach', tags:['ballycastle','seafront','beach','sheskburn','free'], badge:'free', dist:0, walk:'2 min', restriction:'Free all day', notes:'Free 54-space car park behind Sheskburn House on the seafront. Short stroll to Ballycastle Beach. Very popular on sunny summer days — arrive early.', lat:55.2008, lng:-6.2448, by:'Official', votes:0, photo:null, price:null, spaces:54 },
  { id:995, name:'Fair Green Car Park (Fairhill Street)', near:'Ballycastle Fair Green / Town Outskirts', tags:['ballycastle','fair green','fairhill street','free','overflow'], badge:'free', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Spacious free 58-space surface car park on Fairhill Street at the Fair Green. Great overflow option when town centre spots are full.', lat:55.2052, lng:-6.2488, by:'Ballycastle Local', votes:0, photo:null, price:null, spaces:58 },
  { id:996, name:'Castle Street On-Street (Timed)', near:'The Diamond / Holy Trinity Church', tags:['ballycastle','castle street','the diamond','timed','town centre','on-street'], badge:'timed', dist:0, walk:'Right there', restriction:'1 hr max, Mon-Sat 8:30am-6pm (no return within 1 hr)', notes:'On-street bays on Castle Street right beside The Diamond. Limited to 1 hour — free evenings and Sundays.', lat:55.2045, lng:-6.2467, by:'Ballycastle Local', votes:0, photo:null, price:null, spaces:null },
  { id:997, name:'Quay Road On-Street Bays', near:'Ballycastle Harbour Approach', tags:['ballycastle','quay road','harbour','on-street','timed'], badge:'timed', dist:0, walk:'2 min', restriction:'No waiting Mon-Sat 8:30am-6pm; free evenings & Sundays', notes:'On-street bays along Quay Road heading toward the harbour. Useful for a Sunday visit to the harbour area.', lat:55.2022, lng:-6.2440, by:'Ballycastle Local', votes:0, photo:null, price:null, spaces:null },
  { id:998, name:'Bayview Road Waterfront Lay-by', near:'Ballycastle Marina / Ballycastle Beach', tags:['ballycastle','bayview road','marina','waterfront','hidden gem'], badge:'hidden_gem', dist:0, walk:'~3 min', restriction:'Free all day', notes:'Informal lay-by stretch along Bayview Road that most visitors miss entirely. Lovely direct views across the bay toward Rathlin Island.', lat:55.2011, lng:-6.2419, by:'Ballycastle Local', votes:0, photo:null, price:null, spaces:null, premium:true },
  { id:999, name:'North Street Quiet On-Street Parking', near:'Ballycastle Town Centre (North)', tags:['ballycastle','north street','residential','hidden gem','free','locals only'], badge:'hidden_gem', dist:0, walk:'~4 min', restriction:'Free all day', notes:'Quiet residential street just north of the town centre with unrestricted on-street parking. Perfectly placed for walking down into the main shopping area without car park queues.', lat:55.2058, lng:-6.2456, by:'Ballycastle Local', votes:0, photo:null, price:null, spaces:null, premium:true },
];

// ── Banbridge ─────────────────────────────────────────────────────────────────
const BANBRIDGE_SPOTS = [
  { id:1011, name:'Bridge Street East Car Park', near:'Banbridge Town Centre', tags:['banbridge','bridge street','town centre','pay and display','council'], badge:'official', dist:0, walk:'1 min', restriction:'Pay & Display, charged hours Mon-Sat', notes:'Council Pay & Display right in the heart of Banbridge town centre with 66 spaces. Cashless payment via RingGo. Main option for shoppers on Bridge Street.', lat:54.3490, lng:-6.2700, by:'Official', votes:0, photo:null, price:'£0.60/hr', spaces:66 },
  { id:1012, name:'Commercial Road Car Park', near:'Banbridge Town Centre', tags:['banbridge','commercial road','town centre','pay and display','council'], badge:'official', dist:0, walk:'2 min', restriction:'Pay & Display, charged hours Mon-Sat', notes:'Council Pay & Display off Commercial Road, centrally located for access to the main retail and hospitality area. RingGo cashless payment accepted.', lat:54.3496, lng:-6.2695, by:'Official', votes:0, photo:null, price:'£0.60/hr', spaces:80 },
  { id:1013, name:'Newry Street Free Car Park', near:'Newry Street / Banbridge', tags:['banbridge','newry street','free parking','town centre','council'], badge:'free', dist:0, walk:'3 min', restriction:'Free all day', notes:'Council free car park on Newry Street with around 50 spaces — one of the best free options close to the town centre.', lat:54.3475, lng:-6.2715, by:'Banbridge Local', votes:0, photo:null, price:null, spaces:50 },
  { id:1014, name:'Solitude Park Car Park', near:'Solitude Park / River Bann', tags:['banbridge','solitude park','rathfriland street','river bann','park','free'], badge:'free', dist:0, walk:'5 min', restriction:'Free all day, park hours apply', notes:'Free car park serving the 10.5-acre Solitude Park on the banks of the River Bann. Accessed off Rathfriland Street — lovely spot and handy free parking for the town centre too.', lat:54.3468, lng:-6.2740, by:'Banbridge Local', votes:0, photo:null, price:null, spaces:60 },
  { id:1015, name:'Downshire Place Car Park', near:'Downshire Place / Banbridge', tags:['banbridge','downshire place','town centre','pay and display','council'], badge:'official', dist:0, walk:'2 min', restriction:'Pay & Display, Mon-Sat during business hours', notes:'Council Pay & Display at Downshire Place, tucked just off the main town centre. Convenient for Church Square and the upper town area. RingGo accepted.', lat:54.3500, lng:-6.2690, by:'Official', votes:0, photo:null, price:'£0.60/hr', spaces:55 },
  { id:1016, name:'Townsend Street On-Street Parking', near:'Townsend Street / Banbridge town centre', tags:['banbridge','townsend street','on-street','timed','town centre'], badge:'timed', dist:0, walk:'3 min', restriction:'Mon-Sat 8am-6pm, 2hr limit; evenings & Sundays free', notes:'On-street timed parking on Townsend Street running parallel to the main town centre. Free after 6pm and all day Sunday.', lat:54.3505, lng:-6.2680, by:'Banbridge Local', votes:0, photo:null, price:null, spaces:20 },
  { id:1017, name:'Church Square On-Street', near:'Church Square / Holy Trinity Church', tags:['banbridge','church square','holy trinity','on-street','timed','town centre'], badge:'timed', dist:0, walk:'2 min', restriction:'Mon-Sat 8am-6pm limited; free evenings & Sundays', notes:'On-street spaces around Church Square near the historic Holy Trinity Church. Central location and free outside daytime hours.', lat:54.3492, lng:-6.2710, by:'Banbridge Local', votes:0, photo:null, price:null, spaces:15 },
  { id:1018, name:'Tesco Car Park Overflow', near:'Tesco / Castlewellan Road', tags:['banbridge','tesco','castlewellan road','supermarket','free','overflow'], badge:'hidden_gem', dist:0, walk:'~8 min', restriction:'Free, customers only during store hours', notes:'Tesco on Castlewellan Road has a large car park locals use when the town centre is packed on Saturdays. Pop in for milk and use the overflow bays near the trolley bays — rarely full and a flat 8-min walk into town.', lat:54.3487, lng:-6.2638, by:'Banbridge Local', votes:0, photo:null, price:null, spaces:200, premium:false },
  { id:1019, name:'Rathfriland Street Layby', near:'Rathfriland Street / Banbridge south', tags:['banbridge','rathfriland street','layby','free','hidden gem','on-street'], badge:'hidden_gem', dist:0, walk:'~6 min', restriction:'Free all day, no restrictions', notes:'Largely unmarked layby stretch on the south side of Rathfriland Street that most visitors drive straight past. No time limit, free at all hours, short flat walk to the Bridge Street shops.', lat:54.3459, lng:-6.2725, by:'Banbridge Local', votes:0, photo:null, price:null, spaces:18, premium:true },
  { id:1020, name:'Dromore Street On-Street', near:'Dromore Street / north Banbridge', tags:['banbridge','dromore street','on-street','free','north banbridge'], badge:'free', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Free unrestricted on-street parking along Dromore Street on the northern approach to town. Quiet residential road — great fallback when central car parks are busy.', lat:54.3515, lng:-6.2698, by:'Banbridge Local', votes:0, photo:null, price:null, spaces:25 },
];

// ── Magherafelt ───────────────────────────────────────────────────────────────
const MAGHERAFELT_SPOTS = [
  { id:1031, name:'Meadowlane Multi-Storey Car Park', near:'Meadowlane Shopping Centre', tags:['magherafelt','meadowlane','shopping centre','multi-storey','town centre'], badge:'official', dist:0, walk:'Right there', restriction:'Mon-Sat 8:30am-6:30pm (first 2 hrs free)', notes:'Main multi-storey serving Meadowlane Shopping Centre with ~500 spaces. First two hours free — pay at Pay on Foot machines for longer stays. Park Mark Award holder.', lat:54.7560, lng:-6.6095, by:'Official', votes:0, photo:null, price:'First 2 hrs free, then £1/hr', spaces:500 },
  { id:1032, name:'Central Car Park (King Street)', near:"Magherafelt Town Centre / The Diamond", tags:['magherafelt','king street','central car park','town centre','diamond','council'], badge:'official', dist:0, walk:'2 min', restriction:'Mon-Sat 8:30am-6:30pm (Pay on Foot)', notes:'Mid Ulster Council Pay on Foot car park off King Street. First two hours free — great for quick trips into the town centre.', lat:54.7565, lng:-6.6078, by:'Official', votes:0, photo:null, price:'First 2 hrs free, then 40p/hr', spaces:80 },
  { id:1033, name:'Rainey Street Car Park', near:'Rainey Street / town centre shops', tags:['magherafelt','rainey street','town centre','pay and display'], badge:'paid', dist:0, walk:'2 min', restriction:'Mon-Sat 8:30am-6:30pm, free evenings & Sundays', notes:'Council Pay & Display surface car park off Rainey Street. Charges apply during the day but free to use outside charging hours — ideal for evening visits.', lat:54.7553, lng:-6.6062, by:'Official', votes:0, photo:null, price:'40p/hr', spaces:60 },
  { id:1034, name:'Union Road Car Park', near:'Union Road / town centre', tags:['magherafelt','union road','town centre','mixed parking','council'], badge:'timed', dist:0, walk:'3 min', restriction:'2-hr limit Mon-Sat 8:30am-6:30pm, some free bays', notes:'Mid Ulster Council car park on Union Road with a mix of free and paid spaces. Free bays fill quickly on weekday mornings — arrive before 9am.', lat:54.7549, lng:-6.6055, by:'Magherafelt Local', votes:0, photo:null, price:'Some bays free, paid bays 40p/hr', spaces:70 },
  { id:1035, name:'King Street Free Car Park', near:'King Street / Magherafelt library area', tags:['magherafelt','king street','free parking','town centre','library','bridewell'], badge:'free', dist:0, walk:'3 min', restriction:'Free all day', notes:'Free surface car park on King Street, short walk from The Diamond and the Bridewell library. One of the few genuinely free council car parks within easy reach of the town centre.', lat:54.7570, lng:-6.6072, by:'Magherafelt Local', votes:0, photo:null, price:null, spaces:50 },
  { id:1036, name:'Tesco Ballyronan Road Car Park', near:'Tesco Magherafelt Superstore / Ballyronan Road', tags:['magherafelt','tesco','ballyronan road','supermarket','free parking'], badge:'free', dist:0, walk:'5 min', restriction:'Free, customers only (2-hr limit enforced)', notes:'Large free surface car park at the Tesco Superstore on Ballyronan Road. Well lit and spacious — combine parking with a supermarket run. Town centre is a 5-minute walk.', lat:54.7541, lng:-6.6025, by:'Magherafelt Local', votes:0, photo:null, price:null, spaces:200 },
  { id:1037, name:'Lidl Castledawson Road Car Park', near:'Lidl Magherafelt / Castledawson Road', tags:['magherafelt','lidl','castledawson road','supermarket','free parking'], badge:'free', dist:0, walk:'8 min', restriction:'Free, customers only', notes:'Free customer car park at Lidl on Castledawson Road. Rarely busy outside of peak hours and within a 10-minute walk of The Diamond.', lat:54.7530, lng:-6.5985, by:'Magherafelt Local', votes:0, photo:null, price:null, spaces:100 },
  { id:1038, name:'Church Street On-Street Parking', near:"Church Street / St Swithin's Church area", tags:['magherafelt','church street','on-street','timed','town centre'], badge:'timed', dist:0, walk:'~2 min', restriction:'2-hr limit Mon-Sat 8:30am-6:30pm, free evenings & Sundays', notes:'On-street bays on Church Street close to the town centre diamond. Free and unrestricted on Sunday mornings.', lat:54.7562, lng:-6.6088, by:'Magherafelt Local', votes:0, photo:null, price:null, spaces:15 },
  { id:1039, name:'Market Street Lay-By', near:"Market Street / The Diamond", tags:['magherafelt','market street','the diamond','on-street','timed','town centre'], badge:'timed', dist:0, walk:'Right there', restriction:'2-hr limit Mon-Sat 8:30am-6:30pm', notes:'On-street lay-by bays on Market Street right beside The Diamond — most central parking in Magherafelt. Spaces turn over quickly — arrive early or try after 5pm.', lat:54.7556, lng:-6.6068, by:'Magherafelt Local', votes:0, photo:null, price:null, spaces:10 },
  { id:1040, name:'Churchwell Lane Hidden Bays', near:'Broad Street rear / town centre', tags:['magherafelt','churchwell lane','hidden gem','free parking','locals only','broad street'], badge:'hidden_gem', dist:0, walk:'~2 min', restriction:'Free all day', notes:'Tucked behind Broad Street, this quiet backstreet has unmarked free bays that most visitors never find. Cut through off Church Street — walk to The Diamond in under two minutes.', lat:54.7558, lng:-6.6082, by:'Magherafelt Local', votes:0, photo:null, price:null, spaces:12, premium:true },
  { id:1041, name:'Station Road Quiet Lay-By', near:'Station Road / north of town centre', tags:['magherafelt','station road','hidden gem','free parking','locals only','quiet','on-street'], badge:'hidden_gem', dist:0, walk:'~5 min', restriction:'Free all day', notes:'Unrestricted on-street parking on Station Road that most visitors drive straight past. Free all day with no time limit — ~5 minutes on foot to The Diamond.', lat:54.7580, lng:-6.6055, by:'Magherafelt Local', votes:0, photo:null, price:null, spaces:18, premium:true },
];

const CITY_SPOTS = {
  belfast:       SPOTS,
  perth:         PERTH_SPOTS,
  lisburn:       LISBURN_SPOTS,
  bangor:        BANGOR_SPOTS,
  newtownabbey:  NEWTOWNABBEY_SPOTS,
  derry:         DERRY_SPOTS,
  newry:         NEWRY_SPOTS,
  antrim:        ANTRIM_SPOTS,
  ballymena:     BALLYMENA_SPOTS,
  coleraine:     COLERAINE_SPOTS,
  portrush:      PORTRUSH_SPOTS,
  carrickfergus: CARRICKFERGUS_SPOTS,
  larne:         LARNE_SPOTS,
  enniskillen:   ENNISKILLEN_SPOTS,
  omagh:         OMAGH_SPOTS,
  dungannon:     DUNGANNON_SPOTS,
  cookstown:     COOKSTOWN_SPOTS,
  strabane:      STRABANE_SPOTS,
  downpatrick:   DOWNPATRICK_SPOTS,
  newcastle:     NEWCASTLE_SPOTS,
  portadown:     PORTADOWN_SPOTS,
  craigavon:     CRAIGAVON_SPOTS,
  ballycastle:   BALLYCASTLE_SPOTS,
  banbridge:     BANBRIDGE_SPOTS,
  magherafelt:   MAGHERAFELT_SPOTS,
};

const getCitySpots = (cityId) => [ ...(CITY_SPOTS[cityId] || []), ...(EXTRA_SPOTS[cityId] || []), ...(EV_SPOTS[cityId] || []) ];

// Welcome-screen stats — derived from every town's spots so they never go stale.
const ALL_SPOTS_STATS = CITIES.flatMap(c => getCitySpots(c.id));
const WELCOME_STATS = [
  [ALL_SPOTS_STATS.length, 'Spots', '#34E0A0'],
  [ALL_SPOTS_STATS.filter(s => s.badge === 'hidden_gem').length, 'Hidden gems', '#C9A7FF'],
  [ALL_SPOTS_STATS.filter(s => s.badge === 'official').length, 'Car parks', '#7CC4FF'],
  [CITIES.length, 'Towns', '#5BE7DA'],
];

const BUSINESSES = [
  { id:1,  name:"Tommy's Barber",       area:'Glen Road',         addr:'245 Glen Road, West Belfast BT11',    cat:'Barber',         icon:'✂️',  key:'glen road barber',   lat:54.5935, lng:-6.0012 },
  { id:2,  name:'Gransha Grill',        area:'Hannahstown',       addr:'Gransha Road, BT17',                  cat:'Restaurant',     icon:'🍽️',  key:'gransha grill',      lat:54.5901, lng:-5.9942 },
  { id:3,  name:'West Belfast Fitness', area:'Falls Road',        addr:'Falls Road, West Belfast BT12',       cat:'Gym',            icon:'💪',  key:'falls road',         lat:54.5965, lng:-5.9720 },
  { id:4,  name:'The Felons Club',      area:'Andersonstown',     addr:'Andersonstown Road, BT11',            cat:'Social Club',    icon:'🍺',  key:'falls road',         lat:54.5870, lng:-5.9870 },
  { id:5,  name:"Roma's Pizza",         area:'Andersonstown',     addr:'Andersonstown Road, BT11',            cat:'Restaurant',     icon:'🍕',  key:'falls road',         lat:54.5875, lng:-5.9875 },
  { id:6,  name:'Victoria Square',      area:'City Centre',       addr:'Victoria Square, Belfast BT1 4QG',    cat:'Shopping',       icon:'🛍️',  key:'victoria square',    lat:54.5973, lng:-5.9255 },
  { id:7,  name:'Titanic Belfast',      area:'Titanic Quarter',   addr:"Queen's Road, Belfast BT3 9EP",       cat:'Museum',         icon:'🚢',  key:'titanic quarter',    lat:54.6085, lng:-5.9095 },
  { id:8,  name:'The Crown Bar',        area:'City Centre',       addr:'46 Great Victoria Street, BT2 7BA',   cat:'Bar',            icon:'🍻',  key:'city centre',        lat:54.5955, lng:-5.9337 },
  { id:9,  name:"St George's Market",   area:'City Centre',       addr:'12-20 East Bridge Street, BT1 3NQ',   cat:'Market',         icon:'🛒',  key:"st george's market", lat:54.5948, lng:-5.9220 },
  { id:10, name:'The Merchant Hotel',   area:'Cathedral Quarter', addr:'16 Skipper Street, Belfast BT1 2DZ',  cat:'Hotel & Bar',    icon:'🏨',  key:'cathedral quarter',  lat:54.6012, lng:-5.9268 },
  { id:11, name:'W5 Science Centre',    area:'Titanic Quarter',   addr:"2 Queen's Road, Belfast BT3 9QQ",     cat:'Attraction',     icon:'🔬',  key:'titanic quarter',    lat:54.6080, lng:-5.9105 },
  { id:12, name:'Castle Court',         area:'City Centre',       addr:'Royal Avenue, Belfast BT1 1DD',       cat:'Shopping',       icon:'🏬',  key:'castle court',       lat:54.5995, lng:-5.9348 },
  { id:13, name:'Botanic Gardens',      area:'South Belfast',     addr:'Stranmillis Road, Belfast BT9 5AB',   cat:'Park',           icon:'🌿',  key:'botanic gardens',    lat:54.5840, lng:-5.9330 },
  { id:14, name:'Lyric Theatre',        area:'Stranmillis',       addr:'55 Ridgeway Street, Belfast BT9 5FB', cat:'Theatre',        icon:'🎭',  key:'stranmillis',        lat:54.5825, lng:-5.9357 },
  { id:15, name:'Ulster Museum',        area:'Botanic Gardens',   addr:'Botanic Gardens, Belfast BT9 5AB',    cat:'Museum',         icon:'🏛️',  key:'botanic gardens',    lat:54.5837, lng:-5.9322 },
  { id:16, name:'SSE Arena Belfast',    area:'Titanic Quarter',   addr:'2 Queens Quay, Belfast BT3 9QQ',      cat:'Arena',          icon:'🎤',  key:'titanic quarter',    lat:54.6037, lng:-5.9170 },
  { id:17, name:'Belfast City Hall',    area:'City Centre',       addr:'Donegall Square, Belfast BT1 5GS',    cat:'Landmark',       icon:'🏛️',  key:'city hall',          lat:54.5965, lng:-5.9301 },
  { id:18, name:'Parliament Buildings (Stormont)', area:'Stormont', addr:'Stormont Estate, Belfast BT4 3XX',  cat:'Landmark',       icon:'🏛️',  key:'stormont',           lat:54.6038, lng:-5.8345 },
  { id:19, name:'Ulster Hall',          area:'City Centre',       addr:'34 Bedford Street, Belfast BT2 7FF',  cat:'Concert Hall',   icon:'🎵',  key:'ulster hall',        lat:54.5955, lng:-5.9295 },
  { id:20, name:'Grand Opera House',    area:'City Centre',       addr:'2 Great Victoria Street, Belfast BT2 7HR', cat:'Theatre',    icon:'🎭',  key:'grand opera house',  lat:54.5950, lng:-5.9338 },
  { id:21, name:"Queen's University Belfast", area:'South Belfast', addr:'University Road, Belfast BT7 1NN', cat:'University',     icon:'🎓',  key:'queens university',  lat:54.5840, lng:-5.9330 },
];

// Quick-search keyword chips (replaces basic area chips)
const SEARCH_KEYWORDS = [
  'Free parking', 'EV charging', 'City Centre', 'Multi-storey',
  'Titanic Quarter', 'Park & Ride', 'Cathedral Quarter', 'Hidden gems',
  'Cave Hill', 'Black Mountain', 'Lagan Towpath', 'South Belfast',
  'Botanic', 'Ormeau Road', 'West Belfast', 'East Belfast',
  'Lyric Theatre', 'City Hall', 'Stormont', 'Ulster Hall', 'Grand Opera House',
];

// ── Utilities ─────────────────────────────────────────────────────────────────
const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

// Pick the NI town/city whose centre is closest to a given location.
const nearestCity = (lat, lng) => {
  let best = CITIES[0], bestDist = Infinity;
  for (const c of CITIES) {
    const d = haversine(lat, lng, c.center[0], c.center[1]);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
};

// Time-aware "Free right now" engine (per merge brief, ported verbatim).
const isSpotFree = (s) => !s.price;
function parseWindow(r){
  if(!r) return null;
  const days=/Mon\s*[–—-]\s*Sat/i.test(r)?[1,6]:/Mon\s*[–—-]\s*Fri/i.test(r)?[1,5]:null;
  const t=r.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]m)\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i);
  if(!days||!t) return null;
  const h=(n,mn,ap)=>{let x=(+n)%12;if(/pm/i.test(ap))x+=12;return x+(mn?+mn/60:0);};
  return {d0:days[0],d1:days[1],h0:h(t[1],t[2],t[3]),h1:h(t[4],t[5],t[6])};
}
function isFreeNow(s){
  if(s.badge==='official') return isSpotFree(s);
  const w=parseWindow(s.restriction);
  if(!w) return isSpotFree(s);
  const n=new Date(),d=n.getDay(),hr=n.getHours()+n.getMinutes()/60;
  return !(d>=w.d0&&d<=w.d1&&hr>=w.h0&&hr<w.h1);
}

// Spot-type badge pills (semantic accents from the approved reference).
const TYPE_BADGES = {
  free:       { label:'Free',           c:'#34E0A0' },
  hidden_gem: { label:'✨ Hidden gem',  c:'#C9A7FF' },
  timed:      { label:'Timed',          c:'#FFC24B' },
  paid:       { label:'Pay & Display',  c:'#FF9D4B' },
  official:   { label:'Car park',       c:'#7CC4FF' },
};
const TypeBadge = ({ badge }) => {
  const b = TYPE_BADGES[badge]; if (!b) return null;
  return <span className="inline-flex items-center text-[11px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap"
    style={{color:b.c, border:`1px solid ${b.c}59`, background:`${b.c}1a`}}>{b.label}</span>;
};
const FreeNowBadge = ({ spot }) => {
  if (spot.badge === 'official') return null;
  if (!isSpotFree(spot) && isFreeNow(spot)) return <span className="inline-flex items-center text-[11px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap" style={{color:'#34E0A0',border:'1px solid rgba(52,224,160,0.35)',background:'rgba(52,224,160,0.10)'}}>Free right now</span>;
  if (!isFreeNow(spot)) return <span className="inline-flex items-center text-[11px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap" style={{color:'#FFC24B',border:'1px solid rgba(255,194,75,0.35)',background:'rgba(255,194,75,0.10)'}}>Restrictions now</span>;
  return null;
};

const directionsUrl = (lat, lng) => {
  const isIOS = /ipad|iphone|ipod/i.test(navigator.userAgent) && !window.MSStream;
  return isIOS
    ? `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
};

const getAvailability = (spot) => {
  if (!spot.available || !spot.total) return null;
  const pct = spot.available / spot.total;
  if (pct > 0.3) return { color:'#22c55e', label:'Est. available', bg:'rgba(34,197,94,0.12)' };
  if (pct > 0.1) return { color:'#f59e0b', label:'Est. filling',   bg:'rgba(245,158,11,0.12)' };
  if (pct > 0)   return { color:'#ef4444', label:'Est. busy',      bg:'rgba(239,68,68,0.12)' };
  return           { color:'#ef4444', label:'Often full',      bg:'rgba(239,68,68,0.2)' };
};

const ls = {
  get: (k, fb) => {
    try {
      const v = localStorage.getItem(k);
      if (v == null) return fb;
      const parsed = JSON.parse(v);
      // Guard against corrupt/wrong-shape values so a bad localStorage entry
      // can't white-screen the app: if the fallback is an array, require an
      // array; if it's a plain object, require a plain object.
      if (Array.isArray(fb) && !Array.isArray(parsed)) return fb;
      if (fb && typeof fb === 'object' && !Array.isArray(fb) &&
          (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) return fb;
      return parsed ?? fb;
    } catch { return fb; }
  },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ── Badge pill ────────────────────────────────────────────────────────────────
const Badge = ({ type, sm }) => {
  const cfg = BADGES[type] || BADGES.free;
  return (
    <span style={{ background:cfg.bg, color:cfg.fg }}
      className={`font-bold rounded-full whitespace-nowrap ${sm ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'}`}>
      {cfg.label}
    </span>
  );
};

// ── Welcome / Auth Modal ──────────────────────────────────────────────────────
const WelcomeModal = ({ onJoin, onSkip }) => {
  // 'signup' or 'login'. With real accounts (Supabase) we let people do both.
  const [mode, setMode]   = useState('signup');
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');

  const friendlyError = (msg='') => {
    const m = msg.toLowerCase();
    if (m.includes('invalid login')) return 'Wrong email or password. Try again, or reset your password.';
    if (m.includes('already registered') || m.includes('already been registered')) return 'That email already has an account — switch to "Log in".';
    if (m.includes('password') && m.includes('6')) return 'Password must be at least 6 characters.';
    if (m.includes('email') && m.includes('confirm')) return 'Please confirm your email first — check your inbox.';
    return msg || 'Something went wrong. Please try again.';
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError('Please enter a valid email address.'); return; }
    setLoading(true);

    // Fallback: real accounts not configured yet → keep the simple
    // "remember me on this device" behaviour so the app still works.
    if (!isSupabaseEnabled) {
      const userData = { name: name.trim(), email: email.trim(), joined: new Date().toISOString(), spotsAdded: 0 };
      await notifyAdmin(name.trim(), email.trim());
      onJoin(userData);
      return;
    }

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() } },
        });
        if (error) throw error;
        await notifyAdmin(name.trim(), email.trim());
        if (!data.session) {
          // Email confirmation is required (default in Supabase).
          setNotice('Almost there! Check your email for a confirmation link, then log in.');
          setMode('login');
          setPassword('');
          setLoading(false);
          return;
        }
        onJoin(sessionToUser(data.session, name.trim()));
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        onJoin(sessionToUser(data.session));
      }
    } catch (err) {
      setError(friendlyError(err?.message));
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setError(''); setNotice('');
    if (!isSupabaseEnabled) return;
    if (!email.trim()) { setError('Enter your email above first, then tap reset.'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) setError(friendlyError(error.message));
    else setNotice('Password reset link sent — check your email.');
  };

  const isSignup = mode === 'signup';
  const submitLabel = loading
    ? '⏳ Please wait…'
    : isSupabaseEnabled
      ? (isSignup ? 'Create my account →' : 'Log in →')
      : "Join the community — it's free →";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#0e1a2c] rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl my-auto">
        <div className="relative px-6 pt-8 pb-6 text-center overflow-hidden" style={{background:'var(--header-grad)'}}>
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none" style={{background:'radial-gradient(circle, rgba(46,211,198,0.20), rgba(46,211,198,0) 65%)'}}/>
          <div className="relative w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-4 teal-grad" style={{boxShadow:'0 12px 32px rgba(46,211,198,0.45), inset 0 1.5px 0 rgba(255,255,255,0.4)'}}>
            <MapPin size={30} className="text-[#06231f]" strokeWidth={2.6}/>
          </div>
          <h2 className="relative font-display text-white font-extrabold text-2xl tracking-tight">ParkEasy</h2>
          <p className="relative text-[#5BE7DA] text-[13px] font-semibold mt-1">Find where locals actually park — across Northern Ireland</p>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-4 gap-2 text-center">
            {WELCOME_STATS.map(([n,l,c])=>(
              <div key={l} className="bg-white/5 border border-white/10 rounded-2xl py-3">
                <span className="block w-1.5 h-1.5 rounded-full mx-auto mb-1.5" style={{background:c, boxShadow:`0 0 8px ${c}66`}}/>
                <p className="font-display font-extrabold text-[#EAF1F8] text-lg leading-none">{n}</p>
                <p className="text-[#6b7d96] text-[9.5px] font-semibold mt-1 whitespace-nowrap">{l}</p>
              </div>
            ))}
          </div>

          {isSupabaseEnabled && (
            <div className="flex bg-white/8 rounded-xl p-1 text-sm font-bold">
              {[['signup','Sign up'],['login','Log in']].map(([m,label])=>(
                <button key={m} type="button"
                  onClick={()=>{ setMode(m); setError(''); setNotice(''); }}
                  className={`flex-1 py-2 rounded-lg transition-all ${mode===m ? 'teal-grad text-[#06231f] shadow-sm' : 'text-[#6b7d96]'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={submit} className="space-y-3">
            {isSignup && (
              <input
                required value={name} onChange={e=>setName(e.target.value)}
                placeholder="Your first name"
                className="w-full px-4 py-3 border border-white/12 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] bg-white/5"
              />
            )}
            <input
              required type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="Email address" autoComplete="email"
              className="w-full px-4 py-3 border border-white/12 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] bg-white/5"
            />
            {isSupabaseEnabled && (
              <input
                required type="password" value={password} onChange={e=>setPassword(e.target.value)}
                placeholder={isSignup ? 'Create a password (min 6 characters)' : 'Password'}
                autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={6}
                className="w-full px-4 py-3 border border-white/12 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] bg-white/5"
              />
            )}

            {error  && <p className="text-xs text-red-300 bg-red-500/12 rounded-lg px-3 py-2">{error}</p>}
            {notice && <p className="text-xs text-[#6BEFB9] bg-[#34E0A0]/12 rounded-lg px-3 py-2">{notice}</p>}

            <button type="submit" disabled={loading}
              className="w-full bg-[#5BE7DA] text-[#06231f] py-3.5 rounded-xl font-bold text-sm hover:bg-[#2ED3C6]/100 active:scale-[0.98] transition-all shadow-md disabled:opacity-60">
              {submitLabel}
            </button>
          </form>

          {isSupabaseEnabled && !isSignup && (
            <button onClick={resetPassword} type="button"
              className="w-full text-center text-xs text-[#5BE7DA] hover:underline">
              Forgot your password?
            </button>
          )}

          <button onClick={onSkip} className="w-full text-center text-xs text-[#6b7d96] hover:text-[#aebfd4] py-1 transition-colors">
            Browse without an account
          </button>
          <p className="text-center text-[10.5px] text-[#6b7d96] leading-relaxed">Free, no spam — we only use your email for your account and spot updates.</p>
        </div>
      </div>
    </div>
  );
};

// ── Business Listing Modal ────────────────────────────────────────────────────
const BusinessModal = ({ onClose }) => {
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name:'', address:'', email:'', phone:'' });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    await notify('business', {
      name: form.name,
      email: form.email,
      message: `Address: ${form.address}\nPhone: ${form.phone || 'Not provided'}`,
    });
    setDone(true);
  };

  if (done) return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-[#0e1a2c] rounded-3xl w-full max-w-sm p-8 text-center space-y-4 shadow-2xl">
        <div className="w-16 h-16 bg-[#34E0A0]/15 rounded-full flex items-center justify-center mx-auto">
          <Check size={32} className="text-[#6BEFB9]" strokeWidth={2.5}/>
        </div>
        <h3 className="text-xl font-bold text-[#EAF1F8]">Request Received!</h3>
        <p className="text-sm text-[#8da2bd] leading-relaxed">We'll add your business to the directory and map your nearest parking spots within 24 hours.</p>
        <button onClick={onClose} className="w-full bg-[#0e1a2c] text-white py-3 rounded-xl font-bold hover:bg-[#16243a] transition">Done</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-4">
      <div className="bg-[#0e1a2c] rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-[#EAF1F8]">List Your Business Free</h2>
            <p className="text-xs text-[#6b7d96]">Customers see exactly where to park</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="w-8 h-8 bg-white/8 rounded-full flex items-center justify-center text-[#8da2bd] hover:bg-white/10 transition"><X size={16}/></button>
        </div>
        <div className="p-6">
          <form onSubmit={submit} className="space-y-3">
            <input required value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Business name *" className="w-full px-4 py-3 border border-white/12 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] bg-white/5"/>
            <input required value={form.address} onChange={e=>set('address',e.target.value)} placeholder="Full address *" className="w-full px-4 py-3 border border-white/12 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] bg-white/5"/>
            <input required type="email" value={form.email} onChange={e=>set('email',e.target.value)} placeholder="Contact email *" className="w-full px-4 py-3 border border-white/12 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] bg-white/5"/>
            <input value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="Phone (optional)" className="w-full px-4 py-3 border border-white/12 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] bg-white/5"/>
            <button type="submit" disabled={submitting} className="w-full bg-[#5BE7DA] text-[#06231f] py-3.5 rounded-xl font-bold text-sm hover:bg-[#2ED3C6]/100 transition shadow-md disabled:opacity-60">
              {submitting ? '⏳ Sending…' : 'Submit for free listing →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// ── Pricing / Premium Modal ───────────────────────────────────────────────────
const PricingModal = ({ isPremium, onClose, onRedeem }) => {
  const [showCodeBox, setShowCodeBox] = useState(false);
  const [code,        setCode]        = useState('');
  const [codeError,   setCodeError]   = useState(false);

  const submitCode = () => {
    const ok = onRedeem?.(code);
    if (ok) { onClose(); } else { setCodeError(true); }
  };

  // Time-limited Premium (the reward for an approved hidden gem) shows its
  // expiry; subscriptions / VIP (pe_premium) are open-ended.
  const rewardUntil = !ls.get('pe_premium', false) && ls.get('pe_premium_until', 0) > Date.now()
    ? ls.get('pe_premium_until', 0) : null;

  if (isPremium) return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-[#0e1a2c] rounded-3xl w-full max-w-sm p-8 text-center space-y-4 shadow-2xl">
        <div className="w-16 h-16 bg-[#FFC24B]/15 rounded-full flex items-center justify-center mx-auto">
          <Star size={32} className="text-yellow-500" fill="#eab308"/>
        </div>
        <h3 className="text-xl font-bold text-[#EAF1F8]">You're Premium ★</h3>
        <p className="text-sm text-[#8da2bd] leading-relaxed">Full access to all ParkEasy Premium features. Thanks for supporting Belfast's community!</p>
        {rewardUntil && (
          <p className="text-xs font-semibold text-[#5BE7DA]">🏆 Hidden-gem reward — Premium until {new Date(rewardUntil).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}</p>
        )}
        <button onClick={onClose} className="w-full bg-[#0e1a2c] text-white py-3 rounded-xl font-bold hover:bg-[#16243a] transition">Done</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-4">
      <div className="bg-[#0e1a2c] rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div style={{ background: 'linear-gradient(135deg,#0e1a2c 0%,#2d4a6e 100%)' }} className="p-6 text-center relative">
          <button aria-label="Close" onClick={onClose} className="absolute top-4 right-4 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 transition"><X size={16}/></button>
          <div className="w-14 h-14 bg-yellow-400 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
            <Star size={28} fill="currentColor" className="text-[#FFD27A]"/>
          </div>
          <h2 className="text-white font-extrabold text-xl">ParkEasy Premium</h2>
          <p className="text-[#5BE7DA] text-sm mt-1">Unlock the spots only locals know — hand-picked free hidden gems + EV chargers across NI</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            {[
              ['✨','Hidden gems — founder-curated free spots in ideal locations'],
              ['⚡','Premium EV charger spots + charging filter'],
              ['📍','Sort by distance — nearest spots first'],
              ['🗺️','Offline maps — works without signal'],
              ['🔔','Notifications when spots free up'],
              ['💎','Premium badge on your profile'],
            ].map(([icon,text])=>(
              <div key={text} className="flex items-center gap-3 text-sm text-[#cdd9e8]">
                <span className="w-6 text-center text-base">{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <a href={STRIPE_MONTHLY} target="_blank" rel="noreferrer"
              className="block rounded-2xl border-2 border-[#5BE7DA] p-4 text-center hover:bg-[#2ED3C6]/10 active:scale-[0.98] transition-all">
              <p className="text-[10px] text-[#5BE7DA] font-bold uppercase tracking-widest mb-1">Monthly</p>
              <p className="text-3xl font-extrabold text-[#EAF1F8]">£2.99</p>
              <p className="text-xs text-[#6b7d96] mb-3">per month</p>
              <span className="block w-full bg-[#5BE7DA] text-[#06231f] py-2 rounded-xl text-xs font-bold">Subscribe</span>
            </a>
            <a href={STRIPE_ANNUAL} target="_blank" rel="noreferrer"
              className="block rounded-2xl border-2 border-[#0e1a2c] p-4 text-center hover:bg-white/5 active:scale-[0.98] transition-all relative">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-[#FFD27A] text-[9px] font-black px-3 py-1 rounded-full whitespace-nowrap shadow">BEST VALUE</span>
              <p className="text-[10px] text-[#0e1a2c] font-bold uppercase tracking-widest mb-1 mt-1">Annual</p>
              <p className="text-3xl font-extrabold text-[#EAF1F8]">£20</p>
              <p className="text-xs text-[#6b7d96] mb-3">per year</p>
              <span className="block w-full bg-[#0e1a2c] text-white py-2 rounded-xl text-xs font-bold">Subscribe</span>
            </a>
          </div>
          {/* Wallets come from Stripe's hosted checkout: Apple Pay appears
              automatically on Apple devices, Google Pay on Android/Chrome.
              ApplePaySession only exists where Apple Pay can actually run. */}
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {['Apple Pay','Google Pay','Card'].map(w=>(
              <span key={w} className="text-[10px] font-bold px-2.5 py-1 rounded-full border border-white/12 bg-white/5 text-[#aebfd4]">{w}</span>
            ))}
          </div>
          {typeof window !== 'undefined' && window.ApplePaySession && (
            <p className="text-center text-[11px] text-[#6BEFB9] font-semibold">✓ Apple Pay is ready on this device</p>
          )}
          <p className="text-center text-xs text-[#6b7d96]">Secure payment via Stripe · Cancel any time</p>

          {!showCodeBox ? (
            <button onClick={()=>setShowCodeBox(true)} className="block w-full text-center text-xs text-[#6b7d96] underline hover:text-[#aebfd4]">
              Have a VIP code?
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input value={code} onChange={e=>{ setCode(e.target.value); setCodeError(false); }}
                  placeholder="Enter VIP code" autoFocus
                  className="flex-1 border border-white/15 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#5BE7DA]"/>
                <button onClick={submitCode} className="bg-[#0e1a2c] text-white px-4 rounded-xl text-sm font-bold hover:bg-[#16243a] transition">Redeem</button>
              </div>
              {codeError && <p className="text-center text-xs text-red-300">That code isn't valid. Check it and try again.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── User Menu ─────────────────────────────────────────────────────────────────
const UserMenu = ({ user, spotsAdded, isPremium, onSignOut, onUpgrade, onClose, onAdmin }) => (
  <div className="fixed inset-0 z-[150]" onClick={onClose}>
    <div className="absolute top-16 right-3 bg-[#0e1a2c] rounded-2xl shadow-2xl border border-white/10 w-64 overflow-hidden" onClick={e=>e.stopPropagation()}>
      <div style={{background:'var(--surface-solid)'}} className="p-4 flex items-center gap-3">
        <div className="w-11 h-11 bg-[#5BE7DA] rounded-full flex items-center justify-center text-[#06231f] font-bold text-base flex-shrink-0">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-white font-bold text-sm truncate">{user.name}</p>
          <p className="text-[#5BE7DA] text-xs truncate">{user.email}</p>
        </div>
        {isPremium && <Star size={16} className="text-yellow-400 flex-shrink-0 ml-auto" fill="#facc15"/>}
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white/5 rounded-xl p-3 text-center">
            <p className="text-xl font-extrabold text-[#EAF1F8]">{spotsAdded}</p>
            <p className="text-[10px] text-[#6b7d96] font-medium">Spots Added</p>
          </div>
          <div className="bg-white/5 rounded-xl p-3 text-center">
            {isPremium
              ? <><p className="text-yellow-500 font-extrabold text-sm">★ PREMIUM</p><p className="text-[10px] text-[#6b7d96] font-medium">Active</p></>
              : <><p className="text-[#5BE7DA] font-extrabold text-sm">FREE</p><p className="text-[10px] text-[#6b7d96] font-medium">Upgrade →</p></>
            }
          </div>
        </div>
        {!isPremium && (
          <button onClick={onUpgrade} className="w-full bg-yellow-400 text-[#FFD27A] py-2.5 rounded-xl font-bold text-xs hover:bg-yellow-300 transition">
            ★ Upgrade to Premium — £2.99/mo
          </button>
        )}
        {onAdmin && (
          <button onClick={onAdmin} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs text-[#06231f] btn-teal active:scale-95 transition">
            📊 Admin dashboard
          </button>
        )}
        <div className="border-t border-white/10 pt-2">
          <button onClick={onSignOut} className="w-full flex items-center gap-2 text-sm text-red-300 hover:text-red-300 font-medium py-1 transition-colors">
            <LogOut size={15}/> Sign out
          </button>
        </div>
      </div>
    </div>
  </div>
);

// ── SpotCard ──────────────────────────────────────────────────────────────────
// Relative-time label for "last confirmed" freshness signals.
const timeAgo = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s/60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m/60); if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h/24); if (d < 7) return `${d} day${d!==1?'s':''} ago`;
  const w = Math.floor(d/7); if (w < 5) return `${w} week${w!==1?'s':''} ago`;
  return `${Math.floor(d/30)} month${Math.floor(d/30)!==1?'s':''} ago`;
};

// ── Occupancy / price helpers for the redesigned cards ────────────────────────
const occupancyOf = (spot) => {
  if (spot.available != null && spot.total) {
    const ratio = spot.available / spot.total;
    const good = ratio > 0.2;
    return { label:`${spot.available} free`, pct: Math.max(0.05, Math.min(1, ratio)),
      color: good ? '#6BEFB9' : '#FFD27A',
      grad: good ? 'linear-gradient(90deg,#34E0A0,#5BE7DA)' : 'linear-gradient(90deg,#FFC24B,#FF9D4B)' };
  }
  const free = ['free','hidden_gem'].includes(spot.badge);
  if (free) return { label: spot.spaces!=null ? `${spot.spaces} spaces` : 'Free',
    pct:0.85, color:'#6BEFB9', grad:'linear-gradient(90deg,#34E0A0,#5BE7DA)' };
  if (spot.spaces!=null) return { label:`${spot.spaces} spaces`, pct:0.6, color:'#5BE7DA',
    grad:'linear-gradient(90deg,#34E0A0,#5BE7DA)' };
  return { label: spot.badge==='timed' ? 'Timed' : 'Pay & display', pct:0.45, color:'#FFD27A',
    grad:'linear-gradient(90deg,#FFC24B,#FF9D4B)' };
};

const priceParts = (spot) => {
  if (!spot.price) return { big:'Free', small:'' };
  const m = String(spot.price).match(/^([^/]+)\/(.+)$/);
  return m ? { big:m[1].trim(), small:'/'+m[2].trim() } : { big:String(spot.price), small:'' };
};

const amenitiesOf = (spot) => {
  const a=[]; const r=(spot.restriction||'').toLowerCase(); const n=(spot.notes||'').toLowerCase(); const nm=(spot.name||'').toLowerCase();
  if (spot.ev?.available) a.push('EV charging');
  if (n.includes('multi-storey')||n.includes('underground')||nm.includes('multi-storey')) a.push('Covered');
  if (r.includes('24/7')||r.includes('24h')||n.includes('24/7')) a.push('Open 24h');
  if (spot.badge==='official') a.push('Official');
  return a;
};

// ── Compact spot card (tap to open detail) ────────────────────────────────────
const SpotCard = ({ spot, saved, onSave, isPremium, onUpgrade, onOpen }) => {
  if (!isPremium && isGated(spot)) {
    return (
      <button onClick={onUpgrade} className="glass rounded-[22px] w-full text-left p-4 flex items-center gap-3" style={{borderLeft:'4px solid #2ED3C6'}}>
        <div className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center bg-[#2ED3C6]/15 border border-[#2ED3C6]/30 text-lg">{spot.ev?.available ? '⚡' : '✨'}</div>
        <div className="flex-1 min-w-0"><p className="font-bold text-[#EAF1F8] text-sm">{gatedLabel(spot)}</p><p className="text-xs text-[rgba(234,241,248,0.5)] truncate">{spot.near} — free to park, exact spot with Premium</p></div>
        <span className="text-[#06231f] text-xs font-bold px-3 py-2 rounded-xl btn-teal flex-shrink-0">Unlock &#9733;</span>
      </button>
    );
  }
  const occ = occupancyOf(spot); const pr = priceParts(spot);
  const free = ['free','hidden_gem'].includes(spot.badge);
  const theme = CARD_THEME[spot.badge] || CARD_THEME.free;
  const [imgErr,setImgErr] = useState(false);
  const img = spot.photo || (GOOGLE_MAPS_KEY ? spotImageUrl(spot.lat, spot.lng) : null);
  const showImg = img && !imgErr;
  // Availability label as a themable class (light mode re-targets these hexes)
  const occCls = occ.color==='#FFD27A' ? 'text-[#FFD27A]' : occ.color==='#5BE7DA' ? 'text-[#5BE7DA]' : 'text-[#6BEFB9]';
  return (
    <button onClick={()=>onOpen?.(spot)} className="glass rounded-[20px] w-full text-left p-3 flex items-center gap-3 active:scale-[0.99] transition">
      {/* thumbnail image of the parking spot */}
      <div className="w-[60px] h-[60px] rounded-[14px] overflow-hidden flex-shrink-0 flex items-center justify-center" style={{background:theme.grad}}>
        {showImg
          ? <img src={img} alt={spot.name} className="w-full h-full object-cover" onError={()=>setImgErr(true)}/>
          : <Car size={24} strokeWidth={1.4} className="text-white/45"/>}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-display font-bold text-[#EAF1F8] text-[15px] leading-tight truncate">{spot.name}</h3>
        {spot.near && (
          <div className="flex items-center gap-1 mt-0.5 text-[11.5px] text-[rgba(234,241,248,0.55)] min-w-0">
            <MapPin size={11} className="flex-shrink-0"/><span className="truncate">{spot.near}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-0.5 text-[11.5px] text-[rgba(234,241,248,0.55)]">
          <Clock size={11}/>{spot.walk}{spot.dist?` · ${spot.dist} mi`:''}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div style={{width:`${Math.round(occ.pct*100)}%`, background:occ.grad}} className="h-full rounded-full"/>
          </div>
          <span className={`text-[11px] font-bold whitespace-nowrap ${occCls}`}>{occ.label}</span>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between self-stretch flex-shrink-0 py-0.5">
        <div className="font-display font-bold text-[16px] leading-none whitespace-nowrap">
          <span className={free?'text-[#5BE7DA]':'text-[#EAF1F8]'}>{pr.big}</span>
          <span className="text-[10px] font-semibold text-[rgba(234,241,248,0.5)]">{pr.small}</span>
        </div>
        <span role="button" aria-label={saved?'Remove from saved spots':'Save this spot'} onClick={(e)=>{e.stopPropagation();onSave(spot.id);}}
          className={`w-7 h-7 rounded-full flex items-center justify-center ${saved?'teal-grad':'bg-white/8 border border-white/12'}`}>
          <Bookmark size={12} className={saved?'text-[#06231f]':'text-[rgba(234,241,248,0.6)]'} fill={saved?'#06231f':'none'}/>
        </span>
      </div>
    </button>
  );
};

// ── Spot detail sheet ─────────────────────────────────────────────────────────
const SpotDetail = ({ spot, saved, onSave, rating, onRate, voted, onVote, onClose, onStartTimer }) => {
  const [shareDone,setShareDone]=useState(false);
  const [confirmedAt,setConfirmedAt]=useState(()=> spot ? (ls.get('pe_confirmed_at',{})[spot.id]||null) : null);
  if (!spot) return null;
  const confirmCount=(spot.votes||0)+(voted?1:0);
  const confirmedAgo=confirmedAt?timeAgo(confirmedAt):null;
  const confirmStillHere=()=>{ onVote?.(spot.id); const m=ls.get('pe_confirmed_at',{}); m[spot.id]=Date.now(); ls.set('pe_confirmed_at',m); setConfirmedAt(m[spot.id]); };
  const reportHref=`mailto:hello@parkeasy.uk?subject=${encodeURIComponent('Report wrong/gone: '+spot.name)}&body=${encodeURIComponent('This spot may be inaccurate or gone:\n\n'+spot.name+' — '+spot.near+'\nhttps://parkeasy.uk/\n\nWhat is wrong: ')}`;
  const occ = occupancyOf(spot); const pr = priceParts(spot);
  const theme = CARD_THEME[spot.badge] || CARD_THEME.free;
  const ring = spot.available!=null && spot.total ? spot.available/spot.total : occ.pct;
  const C = 2*Math.PI*26; const off = C*(1-Math.max(0.05,Math.min(1,ring)));
  const amen = amenitiesOf(spot);
  const share=async()=>{ const url=location.origin+location.pathname+'#s='+spot.id; const text=`${spot.name} — ${(spot.notes||'').slice(0,90)}`; if(navigator.share){try{await navigator.share({title:'ParkEasy',text,url});}catch{}}else{navigator.clipboard?.writeText(url);setShareDone(true);setTimeout(()=>setShareDone(false),2000);} };
  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end" style={{background:'rgba(6,11,20,0.6)'}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="rounded-t-[28px] overflow-hidden animate-fade-in-up" style={{maxWidth:680,width:'100%',margin:'0 auto',maxHeight:'92vh',background:'var(--sheet)',borderTop:'1px solid var(--hairline)',boxShadow:'var(--sheet-shadow)'}}>
        <div className="relative h-44">
          <MapContainer key={spot.id} center={[spot.lat,spot.lng]} zoom={15} style={{width:'100%',height:'100%'}} zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false} attributionControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
            <Marker position={[spot.lat,spot.lng]} icon={pricePin(spot,true)} interactive={false}/>
          </MapContainer>
          <button onClick={onClose} aria-label="Back" className="absolute top-3 left-3 z-[600] w-10 h-10 rounded-full bg-black/50 border border-white/20 flex items-center justify-center text-white backdrop-blur"><X size={17}/></button>
          <button onClick={()=>onSave(spot.id)} aria-label={saved?'Remove from saved':'Save spot'} className={`absolute top-3 right-3 z-[600] w-10 h-10 rounded-full flex items-center justify-center ${saved?'bg-white text-[#06231f]':'bg-black/50 border border-white/20 text-white backdrop-blur'}`}><Bookmark size={16} fill={saved?'#06231f':'none'}/></button>
        </div>
        <div className="overflow-auto p-5" style={{maxHeight:'calc(92vh - 112px)'}}>
          <h2 className="font-display font-bold text-2xl text-[#EAF1F8] leading-tight">{spot.name}</h2>
          <div className="flex items-center gap-1.5 mt-1.5 text-sm text-[rgba(234,241,248,0.55)]"><MapPin size={14}/>{spot.near}</div>
          <div className="flex flex-wrap gap-1.5 mt-2.5"><TypeBadge badge={spot.badge}/><FreeNowBadge spot={spot}/></div>
          <div className="flex items-center gap-4 mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
            <div className="relative w-16 h-16 flex-shrink-0">
              <svg width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6"/>
                <circle cx="32" cy="32" r="26" fill="none" stroke={occ.color} strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 32 32)"/>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-display font-extrabold text-[#EAF1F8]">{spot.available!=null?spot.available:(spot.spaces!=null?spot.spaces:'✓')}</div>
            </div>
            <div className="flex-1">
              <div className="font-bold text-[#EAF1F8]">{(spot.available??spot.spaces)!=null ? `${spot.available??spot.spaces} spaces typically free` : 'Usually has space'}</div>
              <div className="text-xs text-[rgba(234,241,248,0.5)] mt-0.5">{spot.total?`of ${spot.total} · `:''}community estimate</div>
            </div>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#34E0A0]/12 border border-[#34E0A0]/30 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34E0A0]" style={{boxShadow:'0 0 8px #34E0A0'}}/>
              <span className="text-[10px] font-bold tracking-[0.15em] text-[#6BEFB9]">TYPICAL</span>
            </span>
          </div>
          <div className="flex gap-3 mt-3">
            <div className="flex-1 p-3.5 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-xs text-[rgba(234,241,248,0.5)] font-semibold">Price</div>
              <div className="font-display font-bold text-lg text-[#EAF1F8] mt-0.5">{pr.big}<span className="text-xs text-[rgba(234,241,248,0.5)]">{pr.small}</span></div>
            </div>
            <div className="flex-1 p-3.5 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-xs text-[rgba(234,241,248,0.5)] font-semibold">Walk</div>
              <div className="font-display font-bold text-lg text-[#EAF1F8] mt-0.5">{spot.walk}</div>
            </div>
          </div>
          {amen.length>0 && (
            <div className="flex flex-wrap gap-2 mt-3.5">
              {amen.map(a=>(<span key={a} className="text-xs font-semibold text-[#cdd9e8] bg-white/6 border border-white/10 px-3 py-1.5 rounded-full">{a}</span>))}
            </div>
          )}
          {spot.photo && <img src={spot.photo} alt={spot.name} className="w-full h-40 object-cover rounded-2xl mt-3.5 border border-white/10"/>}
          {spot.notes && <p className="text-sm text-[rgba(234,241,248,0.65)] leading-relaxed mt-4 italic border-l-[3px] border-[#2ED3C6] pl-3">{spot.notes}</p>}
          <div className="flex gap-3 mt-5">
            <a href={directionsUrl(spot.lat,spot.lng)} target="_blank" rel="noreferrer" className="flex-1 py-3.5 rounded-2xl flex items-center justify-center gap-2 font-display font-bold text-[#06231f] btn-teal active:scale-95 transition">
              <Navigation size={18}/>Get directions
            </a>
            <button onClick={share} className="w-[52px] rounded-2xl bg-white/8 border border-white/15 text-[#EAF1F8] flex items-center justify-center">{shareDone?<Check size={18}/>:<Share2 size={18}/>}</button>
          </div>
          {onStartTimer && (
            <button onClick={()=>onStartTimer(spot)} className="w-full mt-3 py-3 rounded-2xl flex items-center justify-center gap-2 font-display font-bold text-sm bg-white/8 border border-white/15 text-[#EAF1F8] hover:bg-white/12 active:scale-95 transition">
              <Timer size={17} className="text-[#5BE7DA]"/>Start parking timer
            </button>
          )}
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-[rgba(234,241,248,0.55)] mb-2.5">
              <Check size={11} className="inline -mt-0.5 text-[#6BEFB9]"/> Confirmed by <strong className="text-[#EAF1F8]">{confirmCount}</strong> driver{confirmCount!==1?'s':''}
              {confirmedAgo && <span className="text-[rgba(234,241,248,0.4)]"> · you confirmed {confirmedAgo}</span>}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={confirmStillHere} disabled={voted}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 rounded-xl border transition ${voted?'bg-[#34E0A0]/15 border-[#34E0A0]/50 text-[#6BEFB9]':'border-white/15 text-[#cdd9e8] hover:border-[#34E0A0]/40'}`}>
                👍 {voted?'Confirmed':'Still here'}
              </button>
              <button onClick={()=>onRate?.(spot.id,'changed')}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 rounded-xl border transition ${rating==='changed'?'bg-[#FFC24B]/15 border-[#FFC24B]/50 text-[#FFD27A]':'border-white/15 text-[#cdd9e8] hover:border-[#FFC24B]/40'}`}>
                👎 Changed
              </button>
              <a href={reportHref}
                className="flex items-center justify-center text-xs font-semibold py-2.5 px-3 rounded-xl border border-white/15 text-[rgba(234,241,248,0.6)] hover:text-red-300 hover:border-red-400/40 transition">
                Report
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Parking session timer ─────────────────────────────────────────────────────
const fmtHMS = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
};

const SessionModal = ({ session, now, onClose, onEnd }) => {
  if (!session) return null;
  const elapsed = Math.max(0, now - session.startedAt);
  const rate = session.rate || 0;
  const cost = rate ? (elapsed / 3600000) * rate : null;
  const R = 52, C = 2 * Math.PI * R;
  const off = C * (1 - ((elapsed % 3600000) / 3600000)); // fills once per hour
  const started = new Date(session.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" style={{background:'rgba(6,11,20,0.7)'}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="rounded-t-[28px] sm:rounded-[28px] w-full overflow-hidden animate-fade-in-up" style={{maxWidth:440,background:'var(--sheet)',border:'1px solid var(--hairline)',boxShadow:'var(--sheet-shadow)'}}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <span className="flex items-center gap-2 text-xs font-bold text-[#6BEFB9]"><span className="w-2 h-2 rounded-full bg-[#34E0A0]" style={{boxShadow:'0 0 8px #34E0A0'}}/>Currently parked</span>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/8 border border-white/12 flex items-center justify-center text-[#cdd9e8]"><X size={15}/></button>
          </div>
          <div className="relative w-44 h-44 mx-auto">
            <svg width="176" height="176" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7"/>
              <circle cx="60" cy="60" r={R} fill="none" stroke="#5BE7DA" strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 60 60)"/>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[11px] tracking-widest font-bold text-[rgba(234,241,248,0.45)]">TIME PARKED</span>
              <span className="font-display font-extrabold text-2xl text-[#EAF1F8] tabular-nums">{fmtHMS(elapsed)}</span>
              <span className="text-[11px] text-[rgba(234,241,248,0.4)] mt-0.5">Started {started}</span>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <div className="flex-1 p-3.5 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-[11px] text-[rgba(234,241,248,0.5)] font-semibold">Est. cost so far</div>
              <div className="font-display font-bold text-lg text-[#EAF1F8] mt-0.5">{cost != null ? `£${cost.toFixed(2)}` : 'Free'}</div>
            </div>
            <div className="flex-1 p-3.5 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-[11px] text-[rgba(234,241,248,0.5)] font-semibold">Rate</div>
              <div className="font-display font-bold text-lg text-[#EAF1F8] mt-0.5">{rate ? `£${rate.toFixed(2)}` : '—'}<span className="text-xs text-[rgba(234,241,248,0.5)]">{rate?'/hr':''}</span></div>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3 p-3.5 rounded-2xl bg-white/5 border border-white/10">
            <div className="w-9 h-9 rounded-xl teal-grad flex items-center justify-center text-[#06231f] font-display font-extrabold">P</div>
            <div className="font-bold text-sm text-[#EAF1F8] truncate">{session.name}</div>
          </div>
          <button onClick={onEnd} className="w-full mt-5 py-3.5 rounded-2xl font-display font-bold text-sm bg-white/8 border border-white/15 text-[#EAF1F8] hover:bg-white/12 active:scale-95 transition">
            End session
          </button>
          <p className="text-[11px] text-center text-[rgba(234,241,248,0.4)] mt-3">A personal reminder only — ParkEasy doesn't charge or pay for parking.</p>
        </div>
      </div>
    </div>
  );
};

// Compact sticky "currently parked" bar shown across the app while a session runs.
const ParkBar = ({ session, now, onOpen, onEnd }) => {
  if (!session) return null;
  const elapsed = Math.max(0, now - session.startedAt);
  const cost = session.rate ? (elapsed / 3600000) * session.rate : null;
  return (
    <div className="sticky z-40 px-3 py-2 flex items-center gap-2" style={{ top:0, background:'linear-gradient(90deg,#0e6a5f,#0c5248)', borderBottom:'1px solid var(--hairline)' }}>
      <button onClick={onOpen} className="flex-1 flex items-center gap-2 text-left min-w-0">
        <span className="w-2 h-2 rounded-full bg-[#6BEFB9] flex-shrink-0" style={{boxShadow:'0 0 8px #34E0A0'}}/>
        <span className="text-xs font-bold text-white truncate">Parked at {session.name}</span>
        <span className="text-xs font-extrabold text-white tabular-nums ml-auto flex-shrink-0">{fmtHMS(elapsed)}{cost!=null?` · ~£${cost.toFixed(2)}`:''}</span>
      </button>
      <button onClick={onEnd} className="text-[11px] font-bold text-[#06231f] bg-[#6BEFB9] px-2.5 py-1 rounded-full flex-shrink-0 active:scale-95">End</button>
    </div>
  );
};


// ── Fleadh Cheoil 2026 event parking (source: Belfast City Council, 16 Jun 2026)
const FLEADH = {
  on: Date.now() < new Date('2026-08-13T00:00:00').getTime(),
  zone: [ // indicative pedestrianised zone — north of City Hall incl. Smithfield & Cathedral Quarter
    [54.6045,-5.9370],[54.6055,-5.9305],[54.6050,-5.9255],[54.6015,-5.9235],
    [54.5975,-5.9245],[54.5978,-5.9310],[54.5990,-5.9360],
  ],
  pr: [
    { name:'Park & Ride — Eikon Exhibition Centre', note:'Close to the M1 · £10/day · free shuttle to Grand Central / Laganside', lat:54.4867, lng:-6.1094 },
    { name:"Park & Ride — Giant's Park", note:'Close to the M2 · £10/day · free shuttle to Grand Central / Laganside', lat:54.6360, lng:-5.9180 },
    { name:'Park & Ride — Belfast Harbour', note:'Near the M3 · £10/day · free shuttle to Grand Central / Laganside', lat:54.6170, lng:-5.9220 },
  ],
  camps: [
    { name:'Titanic camp', lat:54.6050, lng:-5.9090 },
    { name:'Ormeau camp', lat:54.5905, lng:-5.9105 },
    { name:'Falls camp', lat:54.5852, lng:-5.9705 },
  ],
  walkIns: [25, 43, 46, 36], // good spots just outside the closed zone
};

const EventBanner = ({ onOpen }) => !FLEADH.on ? null : (
  <button onClick={onOpen} className="w-full flex items-center gap-3 text-left rounded-2xl px-3.5 py-3 mb-3 active:scale-[0.985] transition"
    style={{background:'linear-gradient(135deg, rgba(201,167,255,0.15), rgba(91,231,218,0.10))', border:'1px solid rgba(201,167,255,0.35)'}}>
    <span className="text-xl">🎻</span>
    <span className="flex-1 min-w-0">
      <span className="block font-display font-bold text-[13.5px] text-[#EAF1F8]">Fleadh Cheoil · 2–9 Aug</span>
      <span className="block text-[11.5px] text-[#cdd9e8] mt-0.5">City centre roads closed — see event parking</span>
    </span>
    <ChevronRight size={16} className="text-[#C9A7FF] flex-shrink-0"/>
  </button>
);

const prPin = () => L.divIcon({ className:'', html:`<div style="padding:4px 9px;border-radius:999px;font:700 12px/1 Manrope,system-ui,sans-serif;color:#06231f;background:linear-gradient(135deg,#54E6D8,#2ED3C6);border:1px solid rgba(255,255,255,0.5);box-shadow:0 6px 16px rgba(0,0,0,0.45);white-space:nowrap">P+R</div>`, iconSize:[40,22], iconAnchor:[20,11] });
const campPin = (label) => L.divIcon({ className:'', html:`<div style="padding:4px 9px;border-radius:999px;font:700 11px/1 Manrope,system-ui,sans-serif;color:#C9A7FF;background:rgba(16,24,40,0.92);border:1px solid rgba(201,167,255,0.5);box-shadow:0 6px 16px rgba(0,0,0,0.45);white-space:nowrap">⛺ ${label}</div>`, iconSize:[70,22], iconAnchor:[35,11] });

const EventOverlay = ({ onClose, saved, onSave, isPremium, onUpgrade, onOpenSpot }) => {
  const walkIns = FLEADH.walkIns.map(id => ALL_SPOTS.find(s => s.id === id)).filter(Boolean);
  return (
    <div className="fixed inset-0 z-[65] flex flex-col overflow-auto" style={{background:'var(--bg-solid)'}}>
      <div className="relative h-56 flex-shrink-0">
        <MapContainer center={[54.606,-5.928]} zoom={12} style={{width:'100%',height:'100%'}} scrollWheelZoom={false} zoomControl={false} dragging={false} attributionControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
          <Polygon positions={FLEADH.zone} pathOptions={{color:'#FF7A7A',weight:2,dashArray:'6 6',fillColor:'#FF5C5C',fillOpacity:0.16}}/>
          {FLEADH.pr.slice(1).map((p,i)=>(<Marker key={i} position={[p.lat,p.lng]} icon={prPin()}/>))}
          {FLEADH.camps.map((c,i)=>(<Marker key={'c'+i} position={[c.lat,c.lng]} icon={campPin(c.name)}/>))}
        </MapContainer>
        <button onClick={onClose} aria-label="Back" className="absolute top-3 left-3 z-[600] w-10 h-10 rounded-full bg-black/50 border border-white/20 flex items-center justify-center text-white backdrop-blur"><X size={18}/></button>
      </div>
      <div className="relative -mt-6 rounded-t-[28px] px-5 pt-3 pb-10 flex-1" style={{background:'var(--sheet)', border:'1px solid var(--hairline)', borderBottom:'none', maxWidth:680, width:'100%', margin:'-24px auto 0'}}>
        <div className="w-10 h-1.5 rounded-full bg-white/20 mx-auto mb-3"/>
        <p className="font-display text-[12px] font-bold tracking-[0.18em] text-[#5BE7DA] uppercase">Event parking</p>
        <h2 className="font-display font-extrabold text-2xl text-[#EAF1F8] mt-1">Fleadh Cheoil 2026</h2>
        <div className="flex items-center gap-1.5 mt-1.5 text-[13px] text-[#8da2bd]"><Clock size={14}/>Sun 2 – Sun 9 Aug · ~800,000 visitors expected</div>
        <span className="inline-block mt-3 text-[11px] font-extrabold px-2.5 py-1 rounded-full" style={{color:'#FF8A8A', border:'1px solid rgba(255,122,122,0.4)', background:'rgba(255,92,92,0.12)'}}>Roads closed 6am 2 Aug → 5am 10 Aug</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3.5 text-[11.5px] font-semibold text-[#cdd9e8]">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded" style={{background:'rgba(255,92,92,0.7)'}}/>Pedestrianised zone (indicative)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded" style={{background:'#34E0A0'}}/>Park &amp; Ride</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded" style={{background:'rgba(201,167,255,0.9)'}}/>Campsites</span>
        </div>
        <div className="mt-3.5 text-[13.5px] leading-relaxed text-[#cdd9e8] bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-3.5">
          <strong className="text-[#EAF1F8]">Don&rsquo;t drive into the city centre.</strong> The centre — including Smithfield and the Cathedral Quarter — is pedestrianised for the week. Most city-centre car parks stay open, but expect diversions and heavy traffic. Deliveries only 4–8am. The red zone is indicative — check the official map at belfastcity.gov.uk/fleadh.
        </div>
        <h3 className="font-display font-bold text-[15px] text-[#EAF1F8] mt-5">Official Park &amp; Ride · £10/day</h3>
        {FLEADH.pr.map((p,i)=>(
          <div key={i} className="flex items-center gap-3 rounded-2xl px-3.5 py-3 mt-2.5 bg-white/5 border border-white/10">
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-[14px] text-[#EAF1F8]">{p.name}</p>
              <p className="text-[12px] text-[#8da2bd] mt-0.5 leading-snug">{p.note}</p>
            </div>
            <a href={directionsUrl(p.lat,p.lng)} target="_blank" rel="noreferrer" aria-label={`Directions to ${p.name}`}
              className="w-10 h-10 rounded-full teal-grad text-[#06231f] flex items-center justify-center flex-shrink-0 active:scale-95 transition"><Navigation size={17}/></a>
          </div>
        ))}
        <div className="mt-3.5 text-[13px] leading-relaxed text-[#cdd9e8] bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-3.5">
          Pre-booking opens <strong className="text-[#EAF1F8]">Mon 6 July</strong> at fleadhcheoil.ie/travel — strongly advised. Free accessible shuttles run to Grand Central Station and Laganside. Blue badge holders get allocated disabled parking when pre-booking.
        </div>
        <h3 className="font-display font-bold text-[15px] text-[#EAF1F8] mt-5 mb-2.5">Good walk-in spots (outside the zone)</h3>
        <div className="space-y-3">
          {/* Event parking is a safety feature — never locked, even for free users */}
          {walkIns.map(s=>(
            <SpotCard key={s.id} spot={s} saved={saved.has(s.id)} onSave={onSave} isPremium={true} onUpgrade={onUpgrade} onOpen={onOpenSpot}/>
          ))}
        </div>
        <a href="https://fleadhcheoil.ie/travel" target="_blank" rel="noreferrer"
          className="mt-5 w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 font-display font-bold text-[15px] text-[#06231f] btn-teal active:scale-95 transition">
          <Navigation size={17}/>Official travel info
        </a>
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

// Map markers rendered as price pills — teal when selected, dark otherwise.
const pricePin = (spot, selected) => {
  const light = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light';
  const free = ['free','hidden_gem'].includes(spot.badge);
  const label = spot.price ? String(spot.price).split('/')[0].trim() : (free ? 'Free' : '£');
  const bg = selected ? 'linear-gradient(135deg,#54E6D8,#2ED3C6)' : light ? 'rgba(255,255,255,0.96)' : 'rgba(16,24,40,0.92)';
  const color = selected ? '#06231f' : light ? '#0B1220' : '#EAF1F8';
  const border = selected ? 'rgba(255,255,255,0.5)' : light ? 'rgba(13,27,54,0.18)' : 'rgba(255,255,255,0.18)';
  const shadow = light && !selected ? '0 4px 12px rgba(13,27,54,0.2)' : '0 6px 16px rgba(0,0,0,0.45)';
  return L.divIcon({
    className: 'pe-price-pin',
    html: `<div style="padding:4px 9px;border-radius:999px;font:700 12px/1 Manrope,system-ui,sans-serif;color:${color};background:${bg};border:1px solid ${border};box-shadow:${shadow};white-space:nowrap;backdrop-filter:blur(6px)">${label}</div>`,
    iconSize: [44, 22], iconAnchor: [22, 11],
  });
};

// Teaser pin for gated spots (free users): a soft dashed marker at an
// APPROXIMATE position — shows the area a gem is in, never the exact kerb.
const gemPin = (spot) => L.divIcon({
  className: 'pe-gem-pin',
  html: `<div style="width:34px;height:34px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:15px;background:rgba(46,211,198,0.18);border:2px dashed rgba(46,211,198,0.7);box-shadow:0 0 0 8px rgba(46,211,198,0.08)">${spot.ev?.available ? '⚡' : '✨'}</div>`,
  iconSize: [34, 34], iconAnchor: [17, 17],
});

// isPremium defaults to true so existing call sites keep exact pins; screens
// that can show gated spots pass the real flag + an upgrade handler.
const ParkingMap = ({ spots, center, zoom=13, height=220, selectedId, flat, isPremium=true, onUpgrade }) => (
  <div style={{height}} className={flat ? 'overflow-hidden border-y border-white/10' : 'rounded-2xl overflow-hidden border border-white/10 shadow-sm'}>
    <MapContainer center={center || BELFAST_CENTER} zoom={zoom}
      style={{width:'100%',height:'100%'}} scrollWheelZoom={false} zoomControl={true}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'/>
      {center && <RecenterMap center={center} zoom={zoom}/>}
      {spots.map(s => (!isPremium && isGated(s)) ? (
        <Marker key={s.id} position={[approxCoord(s.lat), approxCoord(s.lng)]} icon={gemPin(s)}>
          <Popup>
            <div style={{minWidth:160}}>
              <p className="font-bold text-sm mb-1">{gatedLabel(s)}</p>
              <p className="text-xs text-[#8da2bd] leading-relaxed">Around {s.near}. Approximate area — the exact free spot is revealed with Premium.</p>
              <button onClick={onUpgrade}
                className="mt-2 block w-full text-center text-xs bg-[#5BE7DA] text-[#06231f] px-3 py-1.5 rounded-lg font-semibold">
                Unlock Premium ★
              </button>
            </div>
          </Popup>
        </Marker>
      ) : (
        <Marker key={s.id} position={[s.lat,s.lng]} icon={pricePin(s, s.id===selectedId)}>
          <Popup>
            <div style={{minWidth:160}}>
              <p className="font-bold text-sm mb-1">{s.name}</p>
              <Badge type={s.badge} sm/>
              {s.price && <p className="text-xs mt-1.5 font-semibold text-[#cdd9e8]">{s.price}</p>}
              <p className="text-xs text-[#8da2bd] mt-1.5 leading-relaxed">{s.notes.slice(0,80)}…</p>
              <a href={directionsUrl(s.lat,s.lng)} target="_blank" rel="noreferrer"
                className="mt-2 block text-center text-xs bg-[#5BE7DA] text-[#06231f] px-3 py-1.5 rounded-lg font-semibold">
                Directions →
              </a>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  </div>
);

// ── SearchTab ─────────────────────────────────────────────────────────────────
// Filter chips match the approved design: All · Cheapest · Covered · EV.
const BADGE_FILTERS = [
  { id:'all',      label:'All' },
  { id:'freenow',  label:'Free now' },
  { id:'free',     label:'Free' },
  { id:'covered',  label:'Covered' },
  { id:'ev',       label:'EV' },
];

// Numeric price for "Cheapest" sorting (free = 0).
const priceVal = (s) => {
  if (!s.price) return 0;
  const m = String(s.price).match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
};
// A spot is "covered" if it's a multi-storey / underground structure.
const isCovered = (s) => {
  const t = ((s.name||'') + ' ' + (s.notes||'')).toLowerCase();
  return t.includes('multi-storey') || t.includes('multi storey') || t.includes('multistorey') || t.includes('underground');
};
// Apply a chip filter (not the sort) to a spot list.
const applyChip = (arr, chip) => {
  if (chip === 'freenow') return arr.filter(isFreeNow);
  if (chip === 'free')    return arr.filter(isSpotFree);
  if (chip === 'covered') return arr.filter(isCovered);
  if (chip === 'ev')      return arr.filter(s => s.ev?.available);
  return arr;
};

const SORT_OPTIONS_FREE    = [
  { id:'popular', label:'Most Popular' },
  { id:'cheap',   label:'Cheapest' },
  { id:'spaces',  label:'Most spaces' },
  { id:'free',    label:'Free First' },
  { id:'alpha',   label:'A–Z' },
];
const SORT_OPTIONS_PREMIUM = [
  { id:'popular',  label:'Most Popular' },
  { id:'cheap',    label:'Cheapest' },
  { id:'spaces',   label:'Most spaces' },
  { id:'free',     label:'Free First' },
  { id:'distance', label:'📍 Nearest' },
  { id:'alpha',    label:'A–Z' },
];

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

// Returns a street-level image URL for a parking spot.
// Prefers Google Street View when an API key is configured.
// Falls back to a free OpenStreetMap static map tile — no key needed.
const spotImageUrl = (lat, lng) =>
  GOOGLE_MAPS_KEY
    ? `https://maps.googleapis.com/maps/api/streetview?size=600x300&location=${lat},${lng}&fov=90&pitch=0&key=${GOOGLE_MAPS_KEY}`
    : `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=17&size=600x300&maptype=mapnik&markers=${lat},${lng},red-pushpin`;

// Every spot across every city — used for "search any location" so a searched
// address returns the nearest spots regardless of which city is selected.
const ALL_SPOTS = CITIES.flatMap(c => getCitySpots(c.id));

// ── Local landmark search ─────────────────────────────────────────────────────
// Remote geocoders miss plenty of NI landmarks ("Kennedy Centre") and users
// type US spellings ("center"). Before asking Nominatim/Google, try to match
// the query against our own spot names/tags/areas — a hit gives us coordinates
// instantly and works offline.
const normalizePlace = (s) => String(s || '').toLowerCase()
  .replace(/center/g, 'centre')
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Gated spots (hidden gems / premium EV picks) still work as landmarks for
// free users — their tags/areas are public place names ("kennedy centre") —
// but only via area+tags, with APPROXIMATE coordinates and the area as the
// label, so a gem's exact name and kerb position never leak through search.
const landmarkMatches = (term, includeGated) => {
  const q = normalizePlace(term);
  if (q.length < 3) return [];
  const words = q.split(' ');
  const out = [];
  for (const s of ALL_SPOTS) {
    const hide = !includeGated && isGated(s);
    const hay = normalizePlace(hide
      ? `${s.near} ${(s.tags || []).join(' ')}`
      : `${s.name} ${s.near} ${(s.tags || []).join(' ')}`);
    // exact-phrase beats all-words-present; anything less is no match
    const score = hay.includes(q) ? 2 : words.every(w => hay.includes(w)) ? 1 : 0;
    if (score) out.push({
      score,
      spot: s,
      label: hide ? s.near : s.name,
      lat: hide ? approxCoord(s.lat) : s.lat,
      lng: hide ? approxCoord(s.lng) : s.lng,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.spot.votes - a.spot.votes);
};

const localLandmark = (term, includeGated) => {
  const best = landmarkMatches(term, includeGated)[0];
  return best ? { lat: best.lat, lng: best.lng, label: term.trim() } : null;
};

const localSuggestions = (term, includeGated) =>
  landmarkMatches(term, includeGated).slice(0, 3).map((m) => ({
    label: m.label, sub: m.spot.near === m.label ? '' : m.spot.near, lat: m.lat, lng: m.lng,
  }));

// Geocode a free-text place/address to coordinates. Uses Google when a key is
// configured, otherwise the free OpenStreetMap Nominatim service, biased to
// Northern Ireland first and then falling back to a UK-wide lookup.
// Human-readable walk estimate from a distance in miles (~3 mph walking pace).
const walkFromMiles = (mi) => {
  const mins = Math.max(1, Math.round((mi / 3) * 60));
  return mins >= 60 ? `${mi.toFixed(1)} mi away` : `~${mins} min walk`;
};

// Which spots are gated behind Premium for non-subscribers. ONLY founder-curated
// picks lock: ✨ hidden gems (ideal-location, free-to-park kerb/side-road spots
// near high-demand destinations) and ⚡ selected free EV charger spots.
// Never locked, regardless of any flag: community-submitted spots, anything the
// driver already pays to park at, and all council/commercial/timed/on-street
// parking including Park & Ride. Free users still see gated spots as area-only
// teasers — approximate pin + area name, never the exact location or notes.
const isGated = (spot) => {
  if (spot.mine) return false;                                         // community submissions
  if (spot.price) return false;                                        // paid to park → free to view
  if (['official','timed','paid'].includes(spot.badge)) return false;  // car parks, P&R, on-street
  return spot.premium === true;                                        // founder-curated only
};

// Locked-card labelling for a gated spot: what it is + roughly where, nothing more.
const gatedLabel = (spot) => spot.ev?.available ? '⚡ EV charger · Premium' : '✨ Hidden gem · Premium';
// Approximate coordinate for teaser map pins (~±250 m) so free users see the
// area a gem is in without getting its kerb-accurate position.
const approxCoord = (v) => Math.round(v * 200) / 200;

// ── Sheet row (map screen): price chip | name + caption | availability dot ──
const RowItem = ({ spot, isPremium, onUpgrade, onOpen }) => {
  if (!isPremium && isGated(spot)) return (
    <button onClick={onUpgrade} className="w-full flex items-center gap-3 px-2 py-3 rounded-2xl text-left active:bg-white/5 transition">
      <div className="min-w-[56px] h-[46px] rounded-[13px] flex items-center justify-center bg-[#2ED3C6]/12 border border-[#2ED3C6]/25 text-lg">{spot.ev?.available ? '⚡' : '✨'}</div>
      <div className="flex-1 min-w-0"><p className="text-[14.5px] font-bold text-[#EAF1F8]">{gatedLabel(spot)}</p><p className="text-xs text-[rgba(234,241,248,0.5)] truncate">{spot.near} — unlock the exact spot</p></div>
      <span className="text-[#5BE7DA] text-xs font-bold flex-shrink-0">Unlock ★</span>
    </button>
  );
  const occ = occupancyOf(spot); const pr = priceParts(spot); const free = isSpotFree(spot);
  const occCls = occ.color==='#FFD27A' ? 'text-[#FFD27A]' : 'text-[#6BEFB9]';
  const n = spot.available ?? spot.spaces;
  const availTxt = n != null ? `${n} ${free ? 'spaces' : 'free'}` : 'Available';
  return (
    <button onClick={()=>onOpen?.(spot)} className="w-full flex items-center gap-3 px-2 py-2.5 rounded-2xl text-left active:bg-white/5 transition border-b border-white/5 last:border-0">
      <div className={`min-w-[56px] h-[46px] px-2 rounded-[13px] flex items-center justify-center font-display font-extrabold text-[13.5px] flex-shrink-0 ${free ? 'text-[#5BE7DA] bg-[#2ED3C6]/12 border border-[#2ED3C6]/25' : 'text-[#EAF1F8] bg-white/5 border border-white/12'}`}>{pr.big}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[14.5px] font-bold text-[#EAF1F8] truncate">{spot.badge==='hidden_gem'?'✨ ':''}{spot.name}</p>
        <p className="flex items-center gap-1.5 text-[12px] text-[rgba(234,241,248,0.5)] mt-0.5 truncate"><Clock size={12} className="flex-shrink-0"/>{spot.walk}{spot.dist?` · ${spot.dist} mi`:''}</p>
      </div>
      <span className={`flex items-center gap-1.5 text-[12.5px] font-bold flex-shrink-0 ${occCls}`}><span className="w-[7px] h-[7px] rounded-full" style={{background:occ.color}}/>{availTxt}</span>
    </button>
  );
};

// ── List card (search screen): name/price top row, badges, availability bar ──
const ListCard = ({ spot, saved, onSave, isPremium, onUpgrade, onOpen }) => {
  if (!isPremium && isGated(spot)) return (
    <button onClick={onUpgrade} className="glass rounded-[22px] w-full text-left p-4 flex items-center gap-3" style={{borderLeft:'4px solid #2ED3C6'}}>
      <div className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center bg-[#2ED3C6]/15 border border-[#2ED3C6]/30 text-lg">{spot.ev?.available ? '⚡' : '✨'}</div>
      <div className="flex-1 min-w-0"><p className="font-bold text-[#EAF1F8] text-sm">{gatedLabel(spot)}</p><p className="text-xs text-[rgba(234,241,248,0.5)] truncate">{spot.near} — free to park, exact spot with Premium</p></div>
      <span className="text-[#06231f] text-xs font-bold px-3 py-2 rounded-xl btn-teal flex-shrink-0">Unlock ★</span>
    </button>
  );
  const occ = occupancyOf(spot); const pr = priceParts(spot); const free = isSpotFree(spot);
  const occCls = occ.color==='#FFD27A' ? 'text-[#FFD27A]' : 'text-[#6BEFB9]';
  return (
    <div onClick={()=>onOpen?.(spot)} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')onOpen?.(spot);}}
      className="glass rounded-[22px] p-4 cursor-pointer active:scale-[0.985] transition">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display font-bold text-[16px] text-[#EAF1F8] leading-tight">{spot.name}</h3>
          <p className="text-[11.5px] text-[rgba(234,241,248,0.5)] font-semibold mt-1 truncate">{spot.near}{spot.walk?` · ${spot.walk}`:''}{spot.dist?` · ${spot.dist} mi`:''}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="font-display font-extrabold text-[18px] whitespace-nowrap">
            <span className={free?'text-[#5BE7DA]':'text-[#EAF1F8]'}>{pr.big}</span><span className="text-[11px] font-semibold text-[rgba(234,241,248,0.5)]">{pr.small}</span>
          </div>
          <span role="button" aria-label={saved?'Remove from saved spots':'Save this spot'} onClick={e=>{e.stopPropagation();onSave(spot.id);}}
            className={`w-8 h-8 rounded-full flex items-center justify-center ${saved?'teal-grad':'bg-white/8 border border-white/12'}`}>
            <Bookmark size={13} className={saved?'text-[#06231f]':'text-[rgba(234,241,248,0.6)]'} fill={saved?'#06231f':'none'}/>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2.5"><TypeBadge badge={spot.badge}/><FreeNowBadge spot={spot}/></div>
      <div className="flex items-center gap-2.5 mt-3">
        <div className="flex-1 h-[7px] rounded-full bg-white/10 overflow-hidden"><div style={{width:`${Math.round(occ.pct*100)}%`,background:occ.grad}} className="h-full rounded-full"/></div>
        <span className={`text-[12px] font-bold whitespace-nowrap ${occCls}`}>{occ.label}</span>
      </div>
    </div>
  );
};

const SearchTab = ({ mode = 'map', saved, onSave, ratings, onRate, votes, onVote, isPremium, onUpgrade, citySpots, cityCenter, cityName, onAdvertise, onOpenSpot, onCityDetected, onEvent }) => {
  const [query,       setQuery]       = useState('');
  const [badgeFilter, setBadgeFilter] = useState('all');
  const [sortBy,      setSortBy]      = useState('popular');
  const [showMap,     setShowMap]     = useState(true);
  const [showSort,    setShowSort]    = useState(false);
  const [evOnly,      setEvOnly]      = useState(false);
  const [userLoc,     setUserLoc]     = useState(null);
  const [focusSpot,   setFocusSpot]   = useState(null);
  const [geo,         setGeo]         = useState(null);   // {lat,lng,label} of a searched location
  const [geoBusy,     setGeoBusy]     = useState(false);
  const [geoMiss,     setGeoMiss]     = useState(false);
  const [sugs,        setSugs]        = useState([]);     // address autocomplete suggestions
  const inputRef = useRef(null);
  const mapRef = useRef(null);
  const sugTimer = useRef(null);

  const SORT_OPTIONS = isPremium ? SORT_OPTIONS_PREMIUM : SORT_OPTIONS_FREE;

  // Reset map focus when switching city or search criteria
  useEffect(() => { setFocusSpot(null); }, [cityCenter, query, badgeFilter, evOnly]);

  // Auto-route: when an address is searched, switch the active city to the
  // nearest NI town so the header + browse context follow the search.
  useEffect(() => {
    if (geo) { const c = nearestCity(geo.lat, geo.lng); if (c) onCityDetected?.(c.id); }
  }, [geo]);

  const viewOnMap = (spot) => {
    setFocusSpot(spot);
    setShowMap(true);
    setTimeout(() => mapRef.current?.scrollIntoView({behavior:'smooth', block:'center'}), 50);
  };

  // Grab location when distance sort is chosen
  useEffect(() => {
    if (sortBy === 'distance' && !userLoc) {
      // If geolocation isn't available, don't leave the list silently unsorted
      // under a "Nearest" label — fall back to popularity.
      if (!navigator.geolocation) { setSortBy('popular'); return; }
      navigator.geolocation.getCurrentPosition(
        ({coords:{latitude:lat,longitude:lng}}) => setUserLoc([lat,lng]),
        () => setSortBy('popular'),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    }
  }, [sortBy]);

  const filtered = useMemo(() => {
    // Location mode: a searched address/place returns the nearest spots across
    // ALL cities, sorted by real distance, with walk estimates filled in.
    if (geo) {
      let spots = ALL_SPOTS
        .map(s => {
          const d = haversine(geo.lat, geo.lng, s.lat, s.lng);
          return { ...s, dist: Math.round(d * 10) / 10, walk: walkFromMiles(d), _d: d };
        })
        .sort((a, b) => a._d - b._d);
      spots = applyChip(spots, badgeFilter);
      if (evOnly) spots = spots.filter(s => s.ev?.available);
      return spots.slice(0, 25);
    }

    let spots = citySpots;

    if (query.trim()) {
      const lq = query.toLowerCase().trim();
      // A search can also be a venue name (e.g. "Lyric Theatre") or a street
      // address (e.g. "Ridgeway Street") rather than wording used in a spot's
      // own name/notes — match those via the business directory and pull in
      // spots tagged for that business too.
      const matchedBizKeys = BUSINESSES.filter(b =>
        b.name.toLowerCase().includes(lq) ||
        b.area.toLowerCase().includes(lq) ||
        b.addr.toLowerCase().includes(lq)
      ).map(b => b.key);

      spots = spots.filter(s =>
        s.name.toLowerCase().includes(lq) ||
        s.near.toLowerCase().includes(lq) ||
        s.tags.some(t => t.includes(lq)) ||
        s.notes.toLowerCase().includes(lq) ||
        matchedBizKeys.some(k => s.tags.includes(k))
      );
    }

    spots = applyChip(spots, badgeFilter);

    if (evOnly) {
      spots = spots.filter(s => s.ev?.available);
    }

    return [...spots].sort((a, b) => {
      if (sortBy === 'cheap') return priceVal(a) - priceVal(b);
      if (sortBy === 'spaces') return ((b.available??b.spaces)||0) - ((a.available??a.spaces)||0);
      if (sortBy === 'popular') return b.votes - a.votes;
      if (sortBy === 'free') {
        const fa = ['free','hidden_gem'].includes(a.badge) ? 0 : 1;
        const fb = ['free','hidden_gem'].includes(b.badge) ? 0 : 1;
        return fa - fb || b.votes - a.votes;
      }
      if (sortBy === 'distance' && userLoc) {
        return haversine(userLoc[0],userLoc[1],a.lat,a.lng) - haversine(userLoc[0],userLoc[1],b.lat,b.lng);
      }
      if (sortBy === 'alpha') return a.name.localeCompare(b.name);
      return 0;
    });
  }, [geo, citySpots, query, badgeFilter, sortBy, evOnly, userLoc]);

  // Everyone sees every spot — no caps. Gated ones (founder-curated gems + EV
  // picks) render as area-only teaser cards / approximate pins for free users.
  const visibleSpots = filtered;
  const gatedSpots   = isPremium ? [] : filtered.filter(isGated);
  const gatedGems    = gatedSpots.filter(s => !s.ev?.available).length;
  const gatedEv      = gatedSpots.filter(s => s.ev?.available).length;
  const hiddenCount  = gatedSpots.length;

  const isSearching = !!geo || query.trim().length > 0 || badgeFilter !== 'all' || evOnly;
  const mapCenter = geo ? [geo.lat, geo.lng]
    : focusSpot ? [focusSpot.lat, focusSpot.lng]
    : visibleSpots.length ? [visibleSpots[0].lat, visibleSpots[0].lng]
    : cityCenter;
  const mapZoom = focusSpot ? 16 : (geo || isSearching) ? 14 : 12;

  // Submit a search: geocode the text so any address/place returns the nearest
  // spots. A keyword/badge term that isn't a real place falls back to the
  // existing text filter.
  const doSearch = async (q) => {
    setQuery(q);
    setSugs([]);
    inputRef.current?.blur();
    const term = (q || '').trim();
    if (!term) { setGeo(null); setGeoMiss(false); return; }
    // Our own landmarks first (instant, spells "center" fine), then remote.
    const local = localLandmark(term, isPremium);
    if (local) { setGeo(local); setFocusSpot(null); return; }
    setGeoBusy(true); setGeoMiss(false);
    const loc = await geocodeText(normalizePlace(term));
    setGeoBusy(false);
    if (loc) { setGeo(loc); setFocusSpot(null); }
    else { setGeo(null); setGeoMiss(true); }
  };

  // Typing updates the live address/place suggestions (debounced) and clears
  // any active location search so the text filter takes over.
  const onQueryChange = (v) => {
    setQuery(v);
    if (geo) setGeo(null);
    if (geoMiss) setGeoMiss(false);
    clearTimeout(sugTimer.current);
    if (v.trim().length < 3) { setSugs([]); return; }
    sugTimer.current = setTimeout(async () => {
      const local = localSuggestions(v, isPremium);
      const list = await suggestPlaces(v);
      setSugs([...local, ...list].slice(0, 6));
    }, 300);
  };

  // Choose an address/place suggestion → resolve to coordinates, then show the
  // nearest spots to it. (Google suggestions carry a placeId we geocode here.)
  const pickSuggestion = async (s) => {
    setQuery(s.label);
    setSugs([]);
    setGeoMiss(false);
    setFocusSpot(null);
    inputRef.current?.blur();
    // Local landmark suggestions carry their coordinates — no lookup needed.
    if (s.lat != null && s.lng != null) { setGeo({ lat: s.lat, lng: s.lng, label: s.label }); return; }
    setGeoBusy(true);
    const loc = await resolvePlace(s);
    setGeoBusy(false);
    if (loc) setGeo(loc);
    else setGeoMiss(true);
  };

  const clearSearch = () => { setQuery(''); setGeo(null); setGeoMiss(false); setSugs([]); };

  // "Locate me" — find the nearest spots to the user's current position.
  const locateMe = () => {
    if (!navigator.geolocation) return;
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      ({coords}) => { setGeoBusy(false); setFocusSpot(null); setGeo({ lat:coords.latitude, lng:coords.longitude, label:'your location' }); },
      () => setGeoBusy(false),
      { enableHighAccuracy:true, timeout:10000, maximumAge:60000 }
    );
  };

  const freeCount = citySpots.filter(s => ['free','hidden_gem'].includes(s.badge)).length;

  // ── Shared search header (pill search → chips → event banner → notices) ──
  const searchBlock = (
    <div className="px-4 space-y-2.5">
      <div className="relative">
        <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[rgba(234,241,248,0.5)] pointer-events-none"/>
        <input ref={inputRef} aria-label="Search any address or place" value={query}
          onChange={e=>onQueryChange(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') doSearch(query); }}
          placeholder={mode==='map' ? 'Where are you headed?' : 'Street, postcode or place'}
          className="w-full pl-11 pr-10 py-3.5 rounded-full border border-white/12 bg-white/[0.055] text-[15px] text-[#EAF1F8] placeholder-[rgba(234,241,248,0.5)] focus:outline-none focus:ring-2 focus:ring-[#2ED3C6]/50 transition"/>
        {geoBusy && <span className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/25 border-t-[#5BE7DA] rounded-full animate-spin"/>}
        {!geoBusy && (query || geo) && (
          <button aria-label="Clear search" onClick={clearSearch} className="absolute right-3.5 top-1/2 -translate-y-1/2 w-6 h-6 bg-white/10 rounded-full flex items-center justify-center text-[rgba(234,241,248,0.7)] hover:bg-white/20 transition"><X size={12}/></button>
        )}
        {sugs.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 rounded-2xl overflow-hidden z-[20]"
            style={{background:'var(--sheet)',border:'1px solid var(--hairline)',boxShadow:'var(--pop-shadow)'}}>
            {sugs.map((s,i)=>(
              <button key={i} onClick={()=>pickSuggestion(s)}
                className="w-full text-left px-3.5 py-3 flex items-start gap-3 hover:bg-white/5 transition border-b border-white/5 last:border-0">
                <MapPin size={15} className="text-[#5BE7DA] mt-0.5 flex-shrink-0"/>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[#EAF1F8] truncate">{s.label}</span>
                  {s.sub && <span className="block text-xs text-[rgba(234,241,248,0.5)] truncate">{s.sub}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
        {BADGE_FILTERS.map(f => (
          <button key={f.id} onClick={()=>setBadgeFilter(f.id)}
            className={`text-[13.5px] px-4 py-2 rounded-full whitespace-nowrap font-bold flex-shrink-0 transition-all active:scale-95 ${
              badgeFilter===f.id ? 'teal-grad text-[#06231f]' : 'bg-white/[0.05] border border-white/12 text-[#cdd9e8]'}`}>
            {f.label}
          </button>
        ))}
      </div>
      {onEvent && <EventBanner onOpen={onEvent}/>}
      {!geo && !geoBusy && query.trim() && (
        <button onClick={()=>doSearch(query)} className="w-full flex items-center gap-2 text-xs font-semibold text-[#5BE7DA] bg-[#2ED3C6]/10 border border-[#2ED3C6]/25 px-3.5 py-2.5 rounded-2xl hover:bg-[#2ED3C6]/15 transition">
          <Navigation size={13}/> Find parking near &ldquo;{query.trim()}&rdquo; — press Enter
        </button>
      )}
      {geo && (
        <div className="flex items-start gap-2 bg-[#2ED3C6]/10 border border-[#2ED3C6]/25 text-[#cdeef0] text-xs px-3.5 py-3 rounded-2xl">
          <MapPin size={14} className="mt-0.5 flex-shrink-0 text-[#5BE7DA]"/>
          <span className="flex-1">Nearest parking to <strong className="text-[#EAF1F8]">{geo.label}</strong>, closest first.</span>
          <button onClick={clearSearch} className="font-bold underline whitespace-nowrap text-[#5BE7DA]">Clear</button>
        </div>
      )}
      {geoMiss && query.trim() && (
        <div className="flex items-start gap-2 bg-[#FFC24B]/10 border border-[#FFC24B]/25 text-[#FFD27A] text-xs px-3.5 py-3 rounded-2xl">
          <Info size={14} className="mt-0.5 flex-shrink-0"/>
          <span>Couldn&rsquo;t find &ldquo;{query.trim()}&rdquo;. Showing keyword matches — try a fuller address.</span>
        </div>
      )}
    </div>
  );

  const emptyState = (
    <div className="text-center py-12">
      <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3"><Search size={24} className="text-[rgba(234,241,248,0.3)]"/></div>
      <p className="font-bold text-[#EAF1F8]">{citySpots.length===0?'No spots here yet':'No spots found'}</p>
      <p className="text-sm text-[rgba(234,241,248,0.5)] mt-1">{citySpots.length===0?'Be the first — tap Add Spot below.':'Try a fuller address or a different filter.'}</p>
      {citySpots.length>0 && <button onClick={()=>{clearSearch();setBadgeFilter('all');setEvOnly(false);}} className="mt-3 text-xs text-[#5BE7DA] font-semibold underline">Clear filters</button>}
    </div>
  );

  // Counts only what is actually locked: curated hidden gems + premium EV picks.
  const gatedSummary = [
    gatedGems > 0 && `${gatedGems} hidden gem${gatedGems !== 1 ? 's' : ''}`,
    gatedEv   > 0 && `${gatedEv} EV charger spot${gatedEv !== 1 ? 's' : ''}`,
  ].filter(Boolean).join(' & ');
  const premiumTeaser = hiddenCount > 0 && (
    <div onClick={onUpgrade} className="rounded-[22px] border-2 border-dashed border-[#2ED3C6]/40 bg-[#2ED3C6]/8 p-5 text-center cursor-pointer hover:bg-[#2ED3C6]/12 transition-colors">
      <p className="text-2xl mb-1">✨</p>
      <p className="font-bold text-[#EAF1F8] text-sm">{gatedSummary} here — hand-picked by locals</p>
      <p className="text-xs text-[rgba(234,241,248,0.5)] mt-0.5 mb-3">Free to park, ideally placed. Their area shows on the map — Premium reveals the exact spots &amp; directions.</p>
      <span className="inline-block text-[#06231f] text-xs font-bold px-4 py-2 rounded-full btn-teal">★ Unlock Premium</span>
    </div>
  );

  // ── LIST mode (Search tab): kicker + heading, count + sort, full-width cards ──
  if (mode === 'list') {
    const sortLabel = SORT_OPTIONS.find(s=>s.id===sortBy)?.label || 'Sort';
    return (
      <div className="pb-6 pt-2">
        <div className="px-4 pb-3">
          <p className="font-display text-[12px] font-bold tracking-[0.18em] text-[#5BE7DA] uppercase">Northern Ireland</p>
          <h1 className="font-display font-extrabold text-[30px] text-[#EAF1F8] leading-tight mt-0.5">Find parking</h1>
        </div>
        {searchBlock}
        <div className="px-4 pt-3">
          <ParkingMap spots={visibleSpots} center={mapCenter} zoom={mapZoom} height={235} selectedId={focusSpot?.id} isPremium={isPremium} onUpgrade={onUpgrade}/>
        </div>
        <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
          <p className="text-[12.5px] text-[rgba(234,241,248,0.5)] font-semibold"><strong className="text-[#EAF1F8]">{filtered.length}</strong> spot{filtered.length!==1?'s':''}{geo?` near ${geo.label.split(',')[0]}`:''}{hiddenCount>0?` · ${hiddenCount} ✨ Premium`:''}</p>
          <div className="relative">
            <button onClick={()=>setShowSort(v=>!v)} className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-full border border-white/12 bg-white/[0.05] text-[#cdd9e8] font-semibold hover:border-white/25 transition">
              <Filter size={12}/>{sortLabel}
            </button>
            {showSort && (
              <div className="absolute right-0 top-full mt-1 rounded-xl z-50 overflow-hidden w-40" style={{background:'var(--surface-solid)',border:'1px solid var(--hairline)',boxShadow:'var(--pop-shadow)'}}>
                {SORT_OPTIONS.map(o=>(
                  <button key={o.id} onClick={()=>{setSortBy(o.id);setShowSort(false);}}
                    className={`w-full text-left px-3 py-2.5 text-xs font-medium transition-colors hover:bg-white/5 ${sortBy===o.id?'text-[#5BE7DA] font-bold':'text-[#cdd9e8]'}`}>
                    {sortBy===o.id && '✓ '}{o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="px-4 pt-2 space-y-3">
          {filtered.length === 0 ? emptyState : (
            <>
              {visibleSpots.map((s,i)=>(
                <React.Fragment key={s.id}>
                  <ListCard spot={s} saved={saved.has(s.id)} onSave={onSave} isPremium={isPremium} onUpgrade={onUpgrade} onOpen={onOpenSpot}/>
                  {i===1 && onAdvertise && <SponsorCard onAdvertise={onAdvertise}/>}
                </React.Fragment>
              ))}
              {premiumTeaser}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── MAP mode (Nearby tab): full-bleed map + slide-up "Nearby parking" sheet ──
  return (
    <div className="pt-2">
      {searchBlock}
      <div ref={mapRef} className="relative mt-2.5">
        <ParkingMap spots={visibleSpots} center={mapCenter} zoom={mapZoom} height={380} selectedId={focusSpot?.id} isPremium={isPremium} onUpgrade={onUpgrade} flat/>
        <button onClick={locateMe} aria-label="Find parking near me"
          className="absolute right-4 bottom-10 z-[5] w-12 h-12 rounded-full flex items-center justify-center text-[#5BE7DA] shadow-lg active:scale-95 transition"
          style={{background:'var(--float)',border:'1px solid var(--hairline)',backdropFilter:'blur(14px)',WebkitBackdropFilter:'blur(14px)'}}>
          <Crosshair size={20}/>
        </button>
      </div>
      <div className="relative z-[6] -mt-7 rounded-t-[28px] px-4 pt-3 pb-6" style={{background:'var(--sheet)',border:'1px solid var(--hairline)',borderBottom:'none',boxShadow:'var(--sheet-shadow)'}}>
        <div className="w-10 h-1.5 rounded-full bg-white/20 mx-auto mb-3"/>
        <div className="flex items-baseline justify-between mb-2 px-1">
          <h2 className="font-display font-bold text-[17px] text-[#EAF1F8] truncate min-w-0">{geo ? `Parking near ${geo.label}` : 'Nearby parking'}</h2>
          <span className="text-[12.5px] font-semibold text-[rgba(234,241,248,0.5)] flex-shrink-0 pl-2">{filtered.length} spot{filtered.length!==1?'s':''}{hiddenCount>0?` · ${hiddenCount} ✨`:''}</span>
        </div>
        {filtered.length === 0 ? emptyState : (
          <>
            <div>
              {visibleSpots.map(s=>(
                <RowItem key={s.id} spot={s} isPremium={isPremium} onUpgrade={onUpgrade} onOpen={onOpenSpot}/>
              ))}
            </div>
            <div className="pt-3">{premiumTeaser}</div>
          </>
        )}
      </div>
    </div>
  );
};


// ── NearbyTab ─────────────────────────────────────────────────────────────────
const NearbyTab = ({ saved, onSave, ratings, onRate, votes, onVote, cityName, onCityDetected, userSpots = [], isPremium, onUpgrade, onOpenSpot }) => {
  const [loc,     setLoc]     = useState(null);
  const [nearby,  setNearby]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');
  const [focusSpot, setFocusSpot] = useState(null);
  const [fallback,  setFallback]  = useState(null); // name of the town we detected when it has no spots yet
  const mapRef = useRef(null);

  const buildNearby = useCallback((lat, lng) => {
    // Detect which NI town/city the user is closest to. Community-submitted
    // spots are merged in alongside the seeded ones for each town.
    const detected = nearestCity(lat, lng);
    const spotsFor = (cid) => [...userSpots.filter(s => s.city === cid), ...getCitySpots(cid)];
    // Only Belfast has seeded data so far. If the user's nearest town has no
    // spots yet (seeded or community), fall back to the closest Belfast spots
    // so they still see something useful — rather than an empty screen.
    const hasLocalSpots = spotsFor(detected.id).length > 0;
    const sourceCity = hasLocalSpots ? detected : (CITIES.find(c => c.id === 'belfast') || CITIES[0]);
    // Only switch (and persist) the app's city when the detected town actually
    // has spots. On a Belfast fallback we leave the user's chosen city intact —
    // the blue note explains we're showing Belfast — so their pick isn't silently
    // overwritten.
    if (hasLocalSpots) onCityDetected?.(sourceCity.id);
    setFallback(hasLocalSpots ? null : detected.name);
    const sorted = spotsFor(sourceCity.id)
      .map(s => ({...s, realDist: haversine(lat, lng, s.lat, s.lng)}))
      .sort((a,b) => a.realDist - b.realDist)
      .slice(0, 12);
    setNearby(sorted);
    setLoading(false);
  }, [onCityDetected, userSpots]);

  const findNearby = () => {
    setLoading(true); setErr('');
    const fallbackToBelfast = (msg) => {
      const lat = 54.5973, lng = -5.9301;
      setLoc([lat,lng]); buildNearby(lat,lng); setErr(msg);
    };
    if (!navigator.geolocation) {
      fallbackToBelfast('Location isn’t supported on this device — showing spots from Belfast city centre.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({coords:{latitude:lat,longitude:lng}}) => { setLoc([lat,lng]); buildNearby(lat,lng); },
      (e) => fallbackToBelfast(
        e?.code === 1
          ? 'Location access denied — showing spots from Belfast city centre. Enable location to see spots near you.'
          : 'Couldn’t get your location (timed out) — showing spots from Belfast city centre. Tap Refresh to try again.'
      ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const viewOnMap = (spot) => {
    setFocusSpot(spot);
    setTimeout(() => mapRef.current?.scrollIntoView({behavior:'smooth', block:'center'}), 50);
  };

  if (!loc) return (
    <div className="p-8 flex flex-col items-center text-center space-y-5">
      <div className="w-24 h-24 bg-gradient-to-br from-[#eef5ff] to-[#dbeafe] rounded-full flex items-center justify-center shadow-inner">
        <Crosshair size={42} className="text-[#5BE7DA]"/>
      </div>
      <div>
        <h3 className="text-xl font-bold text-[#EAF1F8]">Parking Near You</h3>
        <p className="text-sm text-[#8da2bd] mt-1 max-w-xs leading-relaxed">
          See the closest community-verified spots to your current location — we'll find your town automatically.
        </p>
      </div>
      <button onClick={findNearby} disabled={loading}
        className="flex items-center gap-2 bg-[#5BE7DA] text-[#06231f] px-8 py-3.5 rounded-xl font-semibold hover:bg-[#2ED3C6]/100 active:scale-95 transition-all disabled:opacity-60 shadow-md">
        {loading ? '⏳ Locating…' : <><Crosshair size={18}/>Use My Location</>}
      </button>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {err && (
        <div className="flex items-start gap-2 bg-[#FFC24B]/12 border border-[#FFC24B]/30 text-[#FFD27A] text-xs px-3.5 py-3 rounded-xl">
          <Info size={14} className="mt-0.5 flex-shrink-0"/><span>{err}</span>
        </div>
      )}
      {fallback && (
        <div className="flex items-start gap-2 bg-[#2ED3C6]/10 border border-[#2ED3C6]/25 text-[#5BE7DA] text-xs px-3.5 py-3 rounded-xl">
          <Info size={14} className="mt-0.5 flex-shrink-0"/>
          <span>No community spots in <strong>{fallback}</strong> yet — showing the closest spots we have. Know a good one near you? Add it from the "Add Spot" tab and be the first!</span>
        </div>
      )}
      <div ref={mapRef}>
        <ParkingMap spots={nearby} center={focusSpot ? [focusSpot.lat,focusSpot.lng] : loc} zoom={focusSpot ? 16 : 13} height={240} selectedId={focusSpot?.id} isPremium={isPremium} onUpgrade={onUpgrade}/>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-[#EAF1F8]">{nearby.length ? `${nearby.length} spots near you` : `No spots near you yet`}</p>
        <button onClick={()=>{setLoc(null);setNearby([]);setErr('');setFocusSpot(null);setFallback(null);}} className="text-xs text-[#5BE7DA] font-semibold">Refresh</button>
      </div>
      {nearby.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-[#6b7d96] max-w-xs mx-auto leading-relaxed">No community spots here yet — be the first to add one from the "Add Spot" tab!</p>
        </div>
      )}
      <div className="space-y-4">
        {nearby.map(s=>(
          <SpotCard key={s.id} spot={{...s, dist:Math.round(s.realDist*10)/10}}
            saved={saved.has(s.id)} onSave={onSave} isPremium={isPremium} onUpgrade={onUpgrade} onOpen={onOpenSpot}/>
        ))}
        {!isPremium && nearby.some(isGated) && (
          <div onClick={onUpgrade} className="rounded-2xl border-2 border-dashed border-[#2ED3C6]/40 bg-[#2ED3C6]/8 p-5 text-center cursor-pointer hover:bg-[#2ED3C6]/12 transition-colors">
            <p className="text-2xl mb-1">✨</p>
            <p className="font-bold text-[#EAF1F8] text-sm">{nearby.filter(isGated).length} hand-picked hidden gem{nearby.filter(isGated).length!==1?'s':''} near you</p>
            <p className="text-xs text-[rgba(234,241,248,0.5)] mt-0.5 mb-3">Free to park, ideally placed — Premium reveals the exact spots &amp; directions.</p>
            <span className="inline-block text-[#06231f] text-xs font-bold px-4 py-2 rounded-full btn-teal">★ Unlock Premium</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── BusinessesTab ─────────────────────────────────────────────────────────────
const BusinessesTab = ({ onGetListed, allSpots = SPOTS }) => {
  const [open,      setOpen]      = useState(null);
  const [bizSearch, setBizSearch] = useState('');

  const filtered = useMemo(() => {
    if (!bizSearch.trim()) return BUSINESSES;
    const lq = bizSearch.toLowerCase();
    return BUSINESSES.filter(b =>
      b.name.toLowerCase().includes(lq) ||
      b.area.toLowerCase().includes(lq) ||
      b.cat.toLowerCase().includes(lq) ||
      b.addr.toLowerCase().includes(lq)
    );
  }, [bizSearch]);

  return (
    <div className="p-4 space-y-3">
      {/* CTA */}
      <div className="bg-gradient-to-r from-[#0e1a2c] to-[#2d4a6e] text-white p-4 rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold">Own a business in Belfast?</p>
            <p className="text-xs text-blue-200 mt-0.5 leading-relaxed">Get listed free — customers see exactly where to park when they search for you.</p>
          </div>
          <button onClick={onGetListed}
            className="flex-shrink-0 text-xs bg-[#5BE7DA] text-[#06231f] px-3 py-2 rounded-full font-semibold hover:bg-blue-400 active:scale-95 transition-all whitespace-nowrap">
            Get Listed →
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7d96] pointer-events-none"/>
        <input
          value={bizSearch} onChange={e=>setBizSearch(e.target.value)}
          placeholder="Search businesses…"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-white/12 bg-[#0e1a2c] text-sm text-[#EAF1F8] placeholder-[#6b7d96] focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] transition"
        />
      </div>

      <p className="text-[11px] text-[#6b7d96] uppercase tracking-widest font-bold">{filtered.length} businesses · Belfast</p>

      {filtered.map(b => {
        // Match parking to a business by tag OR geographic proximity (within
        // ~0.2 mi), so community-added spots near a venue show up too. Nearest first.
        const spots = allSpots
          .filter(s => s.tags.some(t => t.includes(b.key)) || haversine(b.lat, b.lng, s.lat, s.lng) <= 0.2)
          .map(s => ({ ...s, _bizDist: haversine(b.lat, b.lng, s.lat, s.lng) }))
          .sort((a, c) => a._bizDist - c._bizDist)
          .slice(0, 8);
        const isOpen = open === b.id;
        return (
          <div key={b.id} className="bg-[#0e1a2c] rounded-2xl shadow-sm border border-white/10 overflow-hidden">
            <button onClick={()=>setOpen(isOpen ? null : b.id)}
              className="w-full p-4 flex items-center gap-3 text-left hover:bg-white/5 active:bg-white/8 transition-colors">
              <div className="w-12 h-12 bg-white/8 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                {b.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[#EAF1F8] text-sm">{b.name}</p>
                <p className="text-xs text-[#6b7d96] truncate">{b.addr}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-[#6b7d96] bg-white/8 px-2 py-0.5 rounded-full font-medium">{b.cat}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#34E0A0]/15 text-[#6BEFB9]">{spots.length} parking spots</span>
                </div>
              </div>
              <ChevronRight size={16} className={`text-[#55657d] transition-transform duration-200 flex-shrink-0 ${isOpen?'rotate-90':''}`}/>
            </button>

            {isOpen && (
              <div className="border-t border-white/10">
                {spots.length > 0 && (
                  <div className="px-3 pt-3">
                    <ParkingMap spots={spots} center={[b.lat, b.lng]} zoom={15} height={180}/>
                  </div>
                )}
                <div className="p-3 space-y-2">
                  {spots.length === 0
                    ? <p className="text-sm text-[#6b7d96] text-center py-6">No spots yet — be the first to add one!</p>
                    : spots.map(s => (
                      <div key={s.id} className="flex gap-3 p-3 bg-white/5 rounded-xl">
                        {s.photo && <img src={s.photo} alt={s.name} className="w-16 h-16 object-cover rounded-lg flex-shrink-0"/>}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="font-semibold text-xs text-[#EAF1F8] flex-1">{s.name}</span>
                            <Badge type={s.badge} sm/>
                          </div>
                          <p className="text-xs text-[#8da2bd] line-clamp-2 italic leading-relaxed">{s.notes}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[10px] text-[#6b7d96]">{s.walk} · {s.restriction}</span>
                            <a href={directionsUrl(s.lat,s.lng)} target="_blank" rel="noreferrer"
                              className="text-[10px] text-[#5BE7DA] font-bold">Directions →</a>
                          </div>
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
const SavedTab = ({ saved, onSave, ratings, onRate, votes, onVote, allSpots = SPOTS, isPremium, onUpgrade, onOpenSpot }) => {
  const spots = allSpots.filter(s => saved.has(s.id));
  const [focusSpot, setFocusSpot] = useState(null);
  const [shared, setShared] = useState(false);
  const mapRef = useRef(null);

  const viewOnMap = (spot) => {
    setFocusSpot(spot);
    setTimeout(() => mapRef.current?.scrollIntoView({behavior:'smooth', block:'center'}), 50);
  };

  // Share the whole saved list — names, restrictions and a directions link each —
  // via the native share sheet, falling back to copying to the clipboard.
  const shareList = async () => {
    const lines = spots.map(s => `📍 ${s.name} — ${s.restriction}\n${directionsUrl(s.lat, s.lng)}`);
    const text = `My ParkEasy saved spots:\n\n${lines.join('\n\n')}`;
    const url = 'https://parkeasy.uk/';
    if (navigator.share) {
      try { await navigator.share({ title: 'My ParkEasy saved spots', text, url }); } catch {}
    } else {
      navigator.clipboard?.writeText(`${text}\n\n${url}`);
      setShared(true);
      setTimeout(() => setShared(false), 2200);
    }
  };

  if (!spots.length) return (
    <div className="p-8 flex flex-col items-center text-center space-y-4">
      <div className="w-24 h-24 bg-white/8 rounded-full flex items-center justify-center">
        <Bookmark size={38} className="text-[#55657d]"/>
      </div>
      <div>
        <h3 className="text-xl font-bold text-[#EAF1F8]">No saved spots</h3>
        <p className="text-sm text-[#8da2bd] mt-1 max-w-xs leading-relaxed">
          Tap the bookmark icon on any parking spot to save it here for quick access.
        </p>
      </div>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-[#EAF1F8]">{spots.length} saved spot{spots.length!==1?'s':''}</p>
        <button onClick={shareList} aria-label="Share my saved spots"
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold border transition-all active:scale-95 ${
            shared ? 'bg-[#34E0A0]/12 border-[#34E0A0]/40 text-[#6BEFB9]' : 'border-white/12 text-[#aebfd4] hover:border-[#5BE7DA] hover:text-[#5BE7DA]'
          }`}>
          {shared ? <><Check size={12}/>Copied!</> : <><Share2 size={12}/>Share list</>}
        </button>
      </div>
      {(spots.length > 1 || focusSpot) && (
        <div ref={mapRef}>
          <ParkingMap spots={spots} center={focusSpot ? [focusSpot.lat,focusSpot.lng] : [spots[0].lat, spots[0].lng]} zoom={focusSpot ? 16 : 12} height={200} selectedId={focusSpot?.id} isPremium={isPremium} onUpgrade={onUpgrade}/>
        </div>
      )}
      <div className="space-y-4">
        {spots.map(s=>(
          <SpotCard key={s.id} spot={s} saved={true} onSave={onSave} isPremium={isPremium} onUpgrade={onUpgrade} onOpen={onOpenSpot}/>
        ))}
      </div>
    </div>
  );
};

// ── AddSpotTab ────────────────────────────────────────────────────────────────
const AddSpotTab = ({ user, onJoinPrompt, onSpotAdded }) => {
  const [form, setForm] = useState({near:'',street:'',type:'',restriction:'',notes:''});
  const [preview, setPreview] = useState(null);   // compressed JPEG dataURL of the space
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [coords, setCoords] = useState(null);   // [lat, lng] captured from GPS
  const [locating, setLocating] = useState(false);
  const [locErr, setLocErr] = useState('');
  const fileRef = useRef(null);

  const SPOT_TYPES   = ['Street parking','Lay-by','Car park','Side road','Grass verge','Private (shared)'];
  const RESTRICTIONS = ['Free all day','Time limited','Evenings free','Weekends free','No restrictions'];
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  // Restriction → map-pin/badge category for the live map.
  const RESTRICTION_TO_BADGE = {
    'Free all day':   'free',
    'No restrictions':'free',
    'Time limited':   'timed',
    'Evenings free':  'timed',
    'Weekends free':  'timed',
  };

  const captureLocation = () => {
    setLocErr('');
    if (!navigator.geolocation) { setLocErr('Location isn’t supported on this device.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({coords:{latitude,longitude}}) => { setCoords([latitude, longitude]); setLocating(false); },
      () => { setLocErr('Couldn’t get your location — you can still submit, but the spot won’t show on the map yet.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Turn the form + captured GPS into a spot the live map/lists can render.
  // Returns null when no location was captured (we then just email it for review).
  const buildSpot = () => {
    if (!coords) return null;
    const [lat, lng] = coords;
    const city = nearestCity(lat, lng);
    const name = (form.street || form.near || 'Community spot').trim();
    const tags = Array.from(new Set(
      `${form.near} ${form.street}`.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)
    ));
    return {
      id: Date.now(),
      name,
      near: form.near.trim() || name,
      tags,
      badge: RESTRICTION_TO_BADGE[form.restriction] || 'free',
      dist: 0,
      walk: 'Your spot',
      restriction: form.restriction,
      notes: form.notes.trim() || `${form.type} added by ${user.name}.`,
      lat, lng,
      by: user.name,
      votes: 0,
      photo: preview,
      price: null,
      spaces: null,
      city: city.id,
      mine: true,
    };
  };

  const submitSpot = async (e) => {
    e.preventDefault();
    if (!form.type || !form.restriction) return;
    setSubmitting(true);
    const newSpot = buildSpot();
    await notify('spot', {
      name: form.near,
      near: form.street,
      email: user.email,
      message: `Submitted by: ${user.name}\nType: ${form.type}\nRestrictions: ${form.restriction}\nNotes: ${form.notes || 'None'}\nCoordinates: ${coords ? `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}` : 'Not captured'}\nPhoto attached: ${preview ? 'yes' : 'no'}`,
      photoData: preview || undefined,
    });
    setDone(true);
    onSpotAdded(newSpot);
  };

  if (!user) return (
    <div className="p-8 flex flex-col items-center text-center space-y-5">
      <div className="w-24 h-24 bg-gradient-to-br from-[#eef5ff] to-[#dbeafe] rounded-full flex items-center justify-center shadow-inner">
        <User size={42} className="text-[#5BE7DA]"/>
      </div>
      <div>
        <h3 className="text-xl font-bold text-[#EAF1F8]">Join to Add a Spot</h3>
        <p className="text-sm text-[#8da2bd] mt-1 max-w-xs leading-relaxed">
          Sign up free to contribute spots. Earn 1 month of Premium for every verified spot you add.
        </p>
      </div>
      <button onClick={onJoinPrompt}
        className="flex items-center gap-2 bg-[#5BE7DA] text-[#06231f] px-8 py-3.5 rounded-xl font-semibold hover:bg-[#2ED3C6]/100 active:scale-95 transition-all shadow-md">
        Join Free — 30 seconds →
      </button>
    </div>
  );

  if (done) return (
    <div className="p-8 flex flex-col items-center text-center space-y-5">
      <div className="w-24 h-24 bg-[#34E0A0]/15 rounded-full flex items-center justify-center">
        <Check size={42} className="text-[#6BEFB9]" strokeWidth={2.5}/>
      </div>
      <div>
        <h3 className="text-2xl font-bold text-[#EAF1F8]">Spot Submitted!</h3>
        <p className="text-sm text-[#8da2bd] mt-1 max-w-xs leading-relaxed">
          {coords
            ? "It's already on your map — and it'll be added for everyone after a quick community review. Thanks for helping Belfast drivers!"
            : 'Your spot will appear after a quick community review. Thanks for helping Belfast drivers!'}
        </p>
      </div>
      <div className="w-full bg-gradient-to-r from-[#0e1a2c] to-[#16243a] text-white px-6 py-4 rounded-2xl text-center space-y-1">
        <p className="font-bold text-base">🏆 1 month Premium on the way!</p>
        <p className="text-[#5BE7DA] text-xs leading-relaxed">We'll review your spot within 24 hours. Once approved we'll email you a link to activate your free Premium month.</p>
      </div>
      <button onClick={()=>{setDone(false);setForm({near:'',street:'',type:'',restriction:'',notes:''});setPreview(null);setCoords(null);setLocErr('');}}
        className="text-[#5BE7DA] text-sm font-bold underline">Submit another spot</button>
    </div>
  );

  return (
    <div className="p-4 space-y-5">
      <div className="bg-gradient-to-r from-[#0e1a2c] to-[#2d4a6e] text-white p-5 rounded-2xl shadow-md">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-yellow-400 rounded-xl flex items-center justify-center flex-shrink-0 shadow">
            <Star size={20} fill="currentColor" className="text-[#FFD27A]"/>
          </div>
          <div>
            <p className="font-extrabold text-base leading-tight">Add a spot → get 1 month Premium FREE</p>
            <p className="text-[#5BE7DA] text-xs mt-0.5">Activated after we review your spot (within 24hrs)</p>
          </div>
        </div>
        <div className="flex gap-2 mt-3 text-xs text-blue-200">
          {['See all spots','Sort by distance','EV filter','Premium badge'].map(f=>(
            <span key={f} className="bg-white/10 px-2 py-1 rounded-full whitespace-nowrap">{f}</span>
          ))}
        </div>
      </div>

      <form onSubmit={submitSpot} className="space-y-5">
        <div>
          <label className="block text-sm font-bold text-[#EAF1F8] mb-2">Photo (optional)</label>
          <button type="button" onClick={()=>fileRef.current.click()}
            className="w-full border-2 border-dashed border-white/15 rounded-xl p-5 flex flex-col items-center gap-2 text-[#6b7d96] hover:border-[#5BE7DA] hover:text-[#5BE7DA] active:scale-[0.98] transition-all">
            {preview
              ? <img src={preview} alt="preview" className="w-full h-32 object-cover rounded-xl"/>
              : <><Camera size={28}/><span className="text-sm font-medium">Tap to upload a photo</span><span className="text-xs text-[#55657d]">JPG, PNG, HEIC</span></>}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e=>{
              const f=e.target.files[0]; if(!f) return;
              const img=new Image();
              img.onload=()=>{
                const scale=Math.min(1, 720/Math.max(img.width,img.height));
                const c=document.createElement('canvas');
                c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
                c.getContext('2d').drawImage(img,0,0,c.width,c.height);
                setPreview(c.toDataURL('image/jpeg',0.8));
                URL.revokeObjectURL(img.src);
              };
              img.src=URL.createObjectURL(f);
            }}/>
          <p className="text-[11px] text-[#6b7d96] mt-1.5">📸 Add a photo of the space — verified hidden gems with a photo earn a <strong className="text-[#5BE7DA]">free month of Premium</strong>.</p>
        </div>

        <div>
          <label className="block text-sm font-bold text-[#EAF1F8] mb-2">Pin the location</label>
          <button type="button" onClick={captureLocation} disabled={locating}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-60 ${
              coords ? 'border-[#34E0A0]/50 bg-[#34E0A0]/12 text-[#6BEFB9]' : 'border-[#5BE7DA] bg-[#eef5ff] text-[#5BE7DA] hover:bg-[#2ED3C6]/10'
            }`}>
            {locating
              ? '⏳ Getting your location…'
              : coords
                ? <><Check size={16}/>Location captured — your spot shows on the map</>
                : <><Crosshair size={16}/>Use my current location</>}
          </button>
          {locErr
            ? <p className="text-xs text-[#FFD27A] mt-1.5">{locErr}</p>
            : !coords && <p className="text-xs text-[#6b7d96] mt-1.5">Stand at the spot and tap this so other drivers can find it on the map. Optional — you can submit without it.</p>}
        </div>

        <div>
          <label className="block text-sm font-bold text-[#EAF1F8] mb-2">What's near this spot? *</label>
          <input required value={form.near} onChange={e=>set('near',e.target.value)}
            placeholder="e.g. Victoria Square, Cathedral Quarter, Titanic Belfast"
            className="w-full px-4 py-3 border border-white/12 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] bg-white/5"/>
        </div>

        <div>
          <label className="block text-sm font-bold text-[#EAF1F8] mb-2">Street or area *</label>
          <input required value={form.street} onChange={e=>set('street',e.target.value)}
            placeholder="e.g. Ann Street, beside Victoria Square"
            className="w-full px-4 py-3 border border-white/12 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] bg-white/5"/>
        </div>

        <div>
          <label className="block text-sm font-bold text-[#EAF1F8] mb-2">Spot type *</label>
          <div className="flex flex-wrap gap-2">
            {SPOT_TYPES.map(t=>(
              <button type="button" key={t} onClick={()=>set('type',t)}
                className={`text-xs px-3 py-2 rounded-full border-2 font-medium transition-all active:scale-95 ${
                  form.type===t ? 'border-[#5BE7DA] bg-[#eef5ff] text-[#5BE7DA]' : 'border-white/12 text-[#aebfd4] bg-[#0e1a2c] hover:border-white/15'
                }`}>{t}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-[#EAF1F8] mb-2">Restrictions *</label>
          <div className="flex flex-wrap gap-2">
            {RESTRICTIONS.map(r=>(
              <button type="button" key={r} onClick={()=>set('restriction',r)}
                className={`text-xs px-3 py-2 rounded-full border-2 font-medium transition-all active:scale-95 ${
                  form.restriction===r ? 'border-[#34E0A0]/50 bg-[#34E0A0]/12 text-[#6BEFB9]' : 'border-white/12 text-[#aebfd4] bg-[#0e1a2c] hover:border-white/15'
                }`}>{r}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-[#EAF1F8] mb-2">Local knowledge (optional)</label>
          <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={3}
            placeholder="What should other drivers know? Restrictions, best times, how many cars fit…"
            className="w-full px-4 py-3 border border-white/12 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5BE7DA] bg-white/5 resize-none"/>
        </div>

        {(!form.type || !form.restriction) && (
          <p className="text-xs text-center text-[#FFD27A] font-medium">Please select a spot type and restriction above</p>
        )}
        <button type="submit" disabled={submitting || !form.type || !form.restriction}
          className="w-full bg-[#0e1a2c] text-white py-4 rounded-xl font-bold text-base hover:bg-[#16243a] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50">
          {submitting ? '⏳ Submitting…' : <><Plus size={20}/>Submit Parking Spot</>}
        </button>
      </form>
    </div>
  );
};

// ── iOS Install Guide Modal ───────────────────────────────────────────────────
const IOSGuide = ({ onClose }) => (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-end justify-center p-4">
    <div className="bg-[#0e1a2c] rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl pb-2">
      <div style={{background:'linear-gradient(135deg,#0e1a2c 0%,#2d4a6e 100%)'}} className="px-6 pt-7 pb-5 text-center">
        <div className="w-14 h-14 bg-[#5BE7DA] rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
          <Smartphone size={26} className="text-white"/>
        </div>
        <h2 className="text-white font-extrabold text-xl">Add to Home Screen</h2>
        <p className="text-[#5BE7DA] text-sm mt-1">Install ParkEasy on your iPhone</p>
      </div>
      <div className="p-6 space-y-4">
        {[
          ['1', '⬆️', 'Tap the Share button', 'The box with an arrow at the bottom of Safari'],
          ['2', '📲', 'Tap "Add to Home Screen"', 'Scroll down in the share sheet to find it'],
          ['3', '✅', 'Tap "Add"', 'ParkEasy appears on your home screen like any app'],
        ].map(([n, emoji, title, desc]) => (
          <div key={n} className="flex items-start gap-3">
            <div className="w-7 h-7 bg-[#5BE7DA] rounded-full flex items-center justify-center text-[#06231f] font-bold text-xs flex-shrink-0 mt-0.5">{n}</div>
            <div>
              <p className="font-bold text-[#EAF1F8] text-sm">{emoji} {title}</p>
              <p className="text-[#6b7d96] text-xs leading-relaxed">{desc}</p>
            </div>
          </div>
        ))}
        <div className="bg-[#2ED3C6]/10 border border-[#2ED3C6]/25 rounded-2xl p-3 text-center">
          <p className="text-xs text-[#5BE7DA] font-medium">Works offline · No App Store needed · Free forever</p>
        </div>
        <button onClick={onClose} className="w-full bg-[#0e1a2c] text-white py-3 rounded-xl font-bold hover:bg-[#16243a] transition">Got it</button>
      </div>
    </div>
  </div>
);

// ── Install Banner ────────────────────────────────────────────────────────────
const InstallBanner = ({ onInstall, onDismiss, isIOS }) => (
  <div className="mx-3 mt-3 bg-gradient-to-r from-[#0e1a2c] to-[#2d4a6e] text-white px-4 py-3 rounded-2xl flex items-center gap-3 shadow-lg">
    <div className="w-10 h-10 bg-[#5BE7DA] rounded-xl flex items-center justify-center flex-shrink-0 shadow">
      <Download size={18} className="text-white"/>
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-bold text-sm leading-tight">Install ParkEasy</p>
      <p className="text-[#5BE7DA] text-xs leading-tight mt-0.5">
        {isIOS ? 'Tap Share → Add to Home Screen' : 'Add to your home screen — works offline'}
      </p>
    </div>
    <button onClick={onInstall}
      className="flex-shrink-0 bg-[#5BE7DA] text-[#06231f] text-xs px-3 py-1.5 rounded-full font-bold hover:bg-blue-400 active:scale-95 transition-all whitespace-nowrap">
      {isIOS ? 'How?' : 'Install'}
    </button>
    <button onClick={onDismiss} className="flex-shrink-0 w-6 h-6 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition">
      <X size={11}/>
    </button>
  </div>
);

// ── Private Space Rental ──────────────────────────────────────────────────────
const RENTAL_SPACE_TYPES = [
  { id:'driveway',   label:'Driveway',   emoji:'🏠' },
  { id:'garage',     label:'Garage',     emoji:'🚗' },
  { id:'covered',    label:'Covered',    emoji:'🏢' },
  { id:'open',       label:'Open Bay',   emoji:'⬜' },
  { id:'ev_charger', label:'EV charger', emoji:'⚡' },
];
const EV_SPEEDS = ['3.6kW','7kW','22kW','50kW+ rapid'];
const EV_CONNECTORS = ['Type 2 (tethered)','Type 2 (socket)','CCS','CHAdeMO','3-pin'];

const RENTAL_AMENITIES = [
  { id:'ev_charging',     label:'EV Charging' },
  { id:'cctv',            label:'CCTV'        },
  { id:'covered',         label:'Covered'     },
  { id:'lighting',        label:'Lighting'    },
  { id:'24_7',            label:'24/7 Access' },
  { id:'height_limit',    label:'Height Limit'},
];

const ListingCard = ({ listing }) => {
  const typeInfo = RENTAL_SPACE_TYPES.find(t => t.id === listing.space_type) || { emoji:'🅿️', label:'Space' };
  return (
    <div className="bg-[#0e1a2c] rounded-2xl shadow-sm border border-white/10 overflow-hidden">
      {listing.photos?.[0] ? (
        <img src={listing.photos[0]} alt={listing.title} className="w-full h-36 object-cover"/>
      ) : (
        <div className="w-full h-36 bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center gap-1">
          <span className="text-4xl">{typeInfo.emoji}</span>
          <span className="text-xs text-indigo-400 font-semibold">{typeInfo.label}</span>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between mb-1 gap-2">
          <h3 className="font-bold text-[#EAF1F8] text-sm leading-tight">{listing.title}</h3>
          <span className="flex-shrink-0 text-xs bg-[#2ED3C6]/10 text-[#5BE7DA] font-semibold px-2 py-0.5 rounded-full">{typeInfo.label}</span>
        </div>
        <p className="text-xs text-[#6b7d96] mb-2">{listing.address}</p>
        <div className="flex gap-3 mb-3">
          {listing.price_per_hour  && <span className="text-xs font-bold text-[#6BEFB9]">£{Number(listing.price_per_hour).toFixed(2)}/hr</span>}
          {listing.price_per_day   && <span className="text-xs font-bold text-[#6BEFB9]">£{Number(listing.price_per_day).toFixed(2)}/day</span>}
          {listing.price_per_month && <span className="text-xs font-bold text-[#6BEFB9]">£{Number(listing.price_per_month).toFixed(0)}/mo</span>}
          {listing.spaces > 1 && <span className="text-xs text-[#6b7d96]">{listing.spaces} spaces</span>}
        </div>
        {listing.amenities?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {listing.amenities.slice(0,4).map(a => {
              const label = String(a).startsWith('speed:') ? `⚡ ${String(a).slice(6)}`
                : String(a).startsWith('connector:') ? String(a).slice(10)
                : a === 'ev_charging' ? '⚡ EV charging'
                : (RENTAL_AMENITIES.find(x => x.id === a)?.label || a);
              return (
                <span key={a} className={`text-[10px] px-2 py-0.5 rounded-full ${String(a).startsWith('speed:')||a==='ev_charging' ? 'bg-[#2ED3C6]/12 text-[#5BE7DA] border border-[#2ED3C6]/25' : 'bg-white/8 text-[#8da2bd]'}`}>
                  {label}
                </span>
              );
            })}
          </div>
        )}
        {listing.description && (
          <p className="text-xs text-[#8da2bd] mb-3 line-clamp-2">{listing.description}</p>
        )}
        <a href={`mailto:${listing.contact_email}?subject=Parking enquiry: ${encodeURIComponent(listing.title)}`}
          onClick={()=>notify('enquiry', { title: listing.title, address: listing.address, ownerEmail: listing.contact_email })}
          className="block w-full bg-[#5BE7DA] text-[#06231f] text-xs font-bold py-2.5 rounded-xl text-center hover:bg-[#34E0A0] transition">
          Contact Owner
        </a>
      </div>
    </div>
  );
};

// ── Listing requirements (client mirror of api/publish-listing.js) ───────────
const PHOTO_SLOTS = {
  residential: [
    { key:'space',    label:'The space itself' },
    { key:'entrance', label:'Entrance from the street' },
    { key:'street',   label:'Street view / how to approach' },
  ],
  organization: [
    { key:'overview', label:'Space overview' },
    { key:'entrance', label:'Entrance' },
    { key:'barrier',  label:'Barrier / gate' },
    { key:'signage',  label:'Signage' },
    { key:'street',   label:'Street approach' },
  ],
};
const ORG_TYPES = ['school','church','sports club','business','community centre','other'];
const AVAILABILITY_PRESETS = ['Event dates only','Weekdays','Weekends','Always'];

// Suggested £/hr for the area (no zone_pricing table yet — city heuristic).
const suggestedPrice = (lat, lng) => {
  if (lat == null) return 1.5;
  const c = nearestCity(lat, lng);
  return ['belfast','derry'].includes(c?.id) ? 2.0 : 1.2;
};

const checkRequirements = (l) => {
  const missing = [];
  const photos = l.photos || [];
  const minPhotos = l.host_type === 'organization' ? 5 : 3;
  if (photos.length < minPhotos) missing.push(`${minPhotos - photos.length} more photo${minPhotos-photos.length!==1?'s':''} (min ${minPhotos})`);
  if (photos.length > 10) missing.push('Maximum 10 photos');
  if ((l.instructions||'').trim().length < 30) missing.push(`"How to find it" too short — ${(l.instructions||'').trim().length}/30 characters`);
  if (l.lat == null || l.lng == null) missing.push('Verified address (pick a suggestion)');
  if (!(l.price_per_hour ?? l.price_per_day ?? l.price_per_month)) missing.push('A price');
  if (!l.availability) missing.push('Availability preset');
  if (!(l.contact_phone||'').trim()) missing.push('Your mobile number');
  const cap = l.spaces ?? 1;
  if (!(cap >= 1 && cap <= 200)) missing.push('Capacity between 1 and 200');
  if (l.space_type === 'ev_charger') {
    const a = l.amenities || [];
    if (!a.some(x=>String(x).startsWith('speed:'))) missing.push('Charger speed');
    if (!a.some(x=>String(x).startsWith('connector:'))) missing.push('Connector type');
  }
  if (l.host_type === 'organization') {
    if (!(l.org_name||'').trim()) missing.push('Organization legal name');
    if (!l.org_type) missing.push('Organization type');
    if (!(l.org_registration||'').trim()) missing.push('Registration number (or "none — explain")');
    if (!(l.access_contact_name||'').trim() || !(l.access_contact_phone||'').trim()) missing.push('Named access contact (name + mobile)');
    if ((l.access_method||'').trim().length < 30) missing.push(`Access method too short — ${(l.access_method||'').trim().length}/30 characters`);
  }
  return missing;
};

// Compress an image file and upload it to Supabase Storage; returns public URL.
const uploadListingPhoto = async (file, uid, slotKey) => {
  const dataUrl = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1100 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${uid}/${Date.now()}-${slotKey}.jpg`;
  const { error } = await supabase.storage.from('listing-photos').upload(path, blob, { contentType:'image/jpeg', upsert:true });
  if (error) throw error;
  return supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl;
};

const ListSpaceForm = ({ user, onBack, onSuccess }) => {
  const [step, setStep]       = useState(0);            // 0 = host type, 1 = form
  const [hostType, setHostType] = useState('residential');
  const [slots, setSlots]     = useState({});           // slotKey -> url
  const [extras, setExtras]   = useState([]);           // extra photo urls
  const [uploading, setUploading] = useState(null);     // slotKey while uploading
  const [f, setF]             = useState({ title:'', description:'', address:'', lat:null, lng:null,
    space_type:'driveway', price_per_hour:'', spaces:1, contact_phone:'', contact_email:user?.email||'',
    instructions:'', availability:null, org_name:'', org_type:null, org_registration:'',
    access_contact_name:'', access_contact_phone:'', access_method:'', ev_speed:null, ev_connector:null });
  const [addrSugs, setAddrSugs] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const sugTimer = useRef(null);
  const set = (k,v) => setF(p=>({...p,[k]:v}));

  const requiredSlots = PHOTO_SLOTS[hostType];
  const photos = [...requiredSlots.map(s=>slots[s.key]).filter(Boolean), ...extras];
  const evAmenities = f.space_type==='ev_charger'
    ? ['ev_charging', ...(f.ev_speed?[`speed:${f.ev_speed}`]:[]), ...(f.ev_connector?[`connector:${f.ev_connector}`]:[])]
    : [];
  const listingShape = { ...f, host_type: hostType, photos, amenities: evAmenities,
    price_per_hour: f.price_per_hour ? parseFloat(f.price_per_hour) : null,
    spaces: hostType==='organization' ? (parseInt(f.spaces)||1) : 1 };
  const missing = checkRequirements(listingShape);
  const canPublish = missing.length === 0;

  const authed = isSupabaseEnabled && user?.id;

  const onAddr = (v) => {
    set('address', v); set('lat', null); set('lng', null);
    clearTimeout(sugTimer.current);
    if (v.trim().length < 3) { setAddrSugs([]); return; }
    sugTimer.current = setTimeout(async () => setAddrSugs(await suggestPlaces(v)), 300);
  };
  const pickAddr = async (sug) => {
    setAddrSugs([]);
    const loc = await resolvePlace(sug);
    if (loc) {
      setF(p => ({ ...p, address: sug.sub ? `${sug.label}, ${sug.sub}` : sug.label, lat: loc.lat, lng: loc.lng,
        price_per_hour: p.price_per_hour || String(suggestedPrice(loc.lat, loc.lng).toFixed(2)) }));
    }
  };

  const onPickPhoto = (slotKey, isExtra) => async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setErr(''); setUploading(slotKey);
    try {
      const url = await uploadListingPhoto(file, user.id, slotKey);
      if (isExtra) setExtras(p => [...p, url].slice(0, 10 - requiredSlots.length));
      else setSlots(p => ({ ...p, [slotKey]: url }));
    } catch (ex) { setErr('Photo upload failed — ' + (ex.message || 'try again')); }
    setUploading(null);
  };

  const buildRow = (status) => ({
    owner_id: user.id, owner_email: user.email,
    title: f.title.trim() || (hostType==='organization' ? f.org_name.trim() : 'Private space'),
    description: f.description.trim() || null,
    address: f.address.trim(), lat: f.lat, lng: f.lng,
    space_type: f.space_type, price_per_hour: listingShape.price_per_hour,
    spaces: listingShape.spaces, photos, amenities: evAmenities,
    contact_email: (f.contact_email || user.email || '').trim(), contact_phone: f.contact_phone.trim() || null,
    instructions: f.instructions.trim() || null, availability: f.availability,
    host_type: hostType,
    org_name: f.org_name.trim() || null, org_type: f.org_type,
    org_registration: f.org_registration.trim() || null,
    access_contact_name: f.access_contact_name.trim() || null,
    access_contact_phone: f.access_contact_phone.trim() || null,
    access_method: f.access_method.trim() || null,
    status,
  });

  const saveDraft = async (silent) => {
    setErr('');
    try {
      const row = buildRow('draft');
      if (draftId) {
        const { error } = await supabase.from('rental_listings').update(row).eq('id', draftId);
        if (error) throw error;
        return draftId;
      }
      const { data, error } = await supabase.from('rental_listings').insert(row).select('id').single();
      if (error) throw error;
      setDraftId(data.id);
      return data.id;
    } catch (ex) { if (!silent) setErr(ex.message || 'Could not save draft'); return null; }
  };

  const publish = async () => {
    if (!canPublish || busy) return;
    setBusy(true); setErr('');
    const id = await saveDraft(false);
    if (!id) { setBusy(false); return; }
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const r = await apiFetch('/api/publish-listing', {
        method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      const d = await r.json().catch(()=>({}));
      if (!r.ok) { setErr(d.missing ? 'Still missing: ' + d.missing.join(' · ') : (d.error || 'Publish failed')); setBusy(false); return; }
      notify('listing', { title: buildRow('x').title, address: f.address, spaceType: f.space_type,
        price: listingShape.price_per_hour ? `£${listingShape.price_per_hour}/hr` : '—', email: user.email });
      onSuccess(hostType, d.status);
    } catch (ex) { setErr(ex.message || 'Publish failed'); }
    setBusy(false);
  };

  const inp = "w-full bg-white/[0.06] border border-white/12 rounded-xl px-3.5 py-3 text-sm text-[#EAF1F8] placeholder-[rgba(234,241,248,0.45)] focus:outline-none focus:ring-2 focus:ring-[#2ED3C6]/60";
  const lbl = "block text-xs font-bold text-[#EAF1F8] uppercase tracking-wide mb-1.5 mt-4";

  if (!authed) return (
    <div className="p-6 text-center pb-28">
      <button onClick={onBack} className="w-8 h-8 bg-white/8 rounded-full flex items-center justify-center mb-6"><X size={16} className="text-[#aebfd4]"/></button>
      <div className="w-16 h-16 bg-[#2ED3C6]/12 border border-[#2ED3C6]/30 rounded-full flex items-center justify-center mx-auto mb-4"><Key size={26} className="text-[#5BE7DA]"/></div>
      <h3 className="font-display font-bold text-[#EAF1F8] text-lg">Sign in to list a space</h3>
      <p className="text-sm text-[#8da2bd] mt-2 max-w-xs mx-auto leading-relaxed">Listing a space needs an account so drivers can book with confidence and you can manage your listing.</p>
    </div>
  );

  // ── Step 0: host type ──
  if (step === 0) return (
    <div className="p-4 pb-28">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="w-8 h-8 bg-white/8 rounded-full flex items-center justify-center"><X size={16} className="text-[#aebfd4]"/></button>
        <h2 className="font-display font-bold text-[#EAF1F8] text-lg">Who&rsquo;s listing this space?</h2>
      </div>
      {[
        ['residential','🏠',"I'm a homeowner",'A driveway, garage or private space at your home'],
        ['organization','🏛️','I represent an organization','School, church, sports club, business or community centre'],
      ].map(([id,icon,title,sub])=>(
        <button key={id} onClick={()=>{ setHostType(id); setStep(1); setSlots({}); setExtras([]); }}
          className="w-full glass rounded-[22px] p-5 mb-3 text-left flex items-center gap-4 active:scale-[0.985] transition">
          <span className="text-3xl">{icon}</span>
          <span className="flex-1">
            <span className="block font-display font-bold text-[#EAF1F8] text-[15px]">{title}</span>
            <span className="block text-xs text-[rgba(234,241,248,0.55)] mt-1">{sub}</span>
          </span>
          <ChevronRight size={18} className="text-[#5BE7DA]"/>
        </button>
      ))}
      <p className="text-[11px] text-[#6b7d96] mt-3 leading-relaxed">Organization listings are reviewed by ParkEasy before they go live (within 24 hours).</p>
    </div>
  );

  // ── Step 1: full form with live checklist ──
  return (
    <div className="p-4 pb-32">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={()=>setStep(0)} className="w-8 h-8 bg-white/8 rounded-full flex items-center justify-center"><X size={16} className="text-[#aebfd4]"/></button>
        <div>
          <h2 className="font-display font-bold text-[#EAF1F8] text-lg leading-tight">List your space</h2>
          <p className="text-[11px] text-[#8da2bd]">{hostType==='organization' ? 'Organization listing · reviewed within 24h' : 'Homeowner listing'}</p>
        </div>
      </div>

      <label className={lbl}>Listing title</label>
      <input className={inp} placeholder={hostType==='organization'?'e.g. St Mary’s Church car park':f.space_type==='ev_charger'?'e.g. 7kW home charger with driveway':'e.g. Private driveway near City Centre'} value={f.title} onChange={e=>set('title',e.target.value)}/>

      <label className={lbl}>What are you listing? *</label>
      <div className="grid grid-cols-5 gap-1.5">
        {RENTAL_SPACE_TYPES.map(t=>(
          <button key={t.id} type="button" onClick={()=>set('space_type',t.id)}
            className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl border text-[10px] font-semibold transition ${f.space_type===t.id?'border-[#2ED3C6] bg-[#2ED3C6]/10 text-[#5BE7DA]':'border-white/12 bg-white/[0.04] text-[#8da2bd]'}`}>
            <span className="text-lg">{t.emoji}</span>{t.label}
          </button>
        ))}
      </div>

      {f.space_type==='ev_charger' && (<>
        <label className={lbl}>Charger speed *</label>
        <div className="flex flex-wrap gap-2">
          {EV_SPEEDS.map(sp=>(
            <button key={sp} type="button" onClick={()=>set('ev_speed',sp)}
              className={`text-xs px-3 py-2 rounded-full border font-semibold transition ${f.ev_speed===sp?'teal-grad text-[#06231f] border-transparent':'bg-white/[0.05] border-white/12 text-[#cdd9e8]'}`}>{sp}</button>
          ))}
        </div>
        <label className={lbl}>Connector *</label>
        <div className="flex flex-wrap gap-2">
          {EV_CONNECTORS.map(cn=>(
            <button key={cn} type="button" onClick={()=>set('ev_connector',cn)}
              className={`text-xs px-3 py-2 rounded-full border font-semibold transition ${f.ev_connector===cn?'teal-grad text-[#06231f] border-transparent':'bg-white/[0.05] border-white/12 text-[#cdd9e8]'}`}>{cn}</button>
          ))}
        </div>
        <p className="text-[11px] text-[#6b7d96] mt-2 leading-relaxed">⚡ Tip: set your hourly price to cover electricity (a 7kW charger uses ~£2 of electricity per hour at ~28p/kWh) plus your margin.</p>
      </>)}

      {hostType==='organization' && (<>
        <label className={lbl}>Organization legal name *</label>
        <input className={inp} placeholder="Registered name" value={f.org_name} onChange={e=>set('org_name',e.target.value)}/>
        <label className={lbl}>Organization type *</label>
        <div className="flex flex-wrap gap-2">
          {ORG_TYPES.map(t=>(
            <button key={t} type="button" onClick={()=>set('org_type',t)}
              className={`text-xs px-3 py-2 rounded-full border font-semibold capitalize transition ${f.org_type===t?'teal-grad text-[#06231f] border-transparent':'bg-white/[0.05] border-white/12 text-[#cdd9e8]'}`}>{t}</button>
          ))}
        </div>
        <label className={lbl}>Registration number *</label>
        <input className={inp} placeholder='Charity no., Companies House no., or "none — explain"' value={f.org_registration} onChange={e=>set('org_registration',e.target.value)}/>
        <label className={lbl}>Access contact on the day *</label>
        <div className="grid grid-cols-2 gap-2">
          <input className={inp} placeholder="Name (e.g. caretaker)" value={f.access_contact_name} onChange={e=>set('access_contact_name',e.target.value)}/>
          <input className={inp} type="tel" placeholder="Their mobile" value={f.access_contact_phone} onChange={e=>set('access_contact_phone',e.target.value)}/>
        </div>
        <label className={lbl}>Access method * <span className="normal-case font-medium text-[#6b7d96]">({(f.access_method||'').trim().length}/30 min)</span></label>
        <textarea className={inp} rows={2} placeholder='e.g. "Text the caretaker on arrival and he’ll open the barrier"' value={f.access_method} onChange={e=>set('access_method',e.target.value)}/>
        <label className={lbl}>Capacity — number of spaces *</label>
        <input className={inp} type="number" min={1} max={200} value={f.spaces} onChange={e=>set('spaces',e.target.value)}/>
      </>)}

      <label className={lbl}>Address * <span className="normal-case font-medium text-[#6b7d96]">(pick a suggestion so we can pin it)</span></label>
      <div className="relative">
        <input className={inp} placeholder="Start typing the address…" value={f.address} onChange={e=>onAddr(e.target.value)}/>
        {f.lat!=null && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6BEFB9]"><Check size={16}/></span>}
        {addrSugs.length>0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 rounded-xl overflow-hidden z-30" style={{background:'var(--surface-solid)',border:'1px solid var(--hairline)',boxShadow:'var(--pop-shadow)'}}>
            {addrSugs.map((sg,i)=>(
              <button key={i} type="button" onClick={()=>pickAddr(sg)} className="w-full text-left px-3.5 py-2.5 flex items-start gap-2.5 hover:bg-white/5 border-b border-white/5 last:border-0">
                <MapPin size={13} className="text-[#5BE7DA] mt-0.5 flex-shrink-0"/>
                <span className="min-w-0"><span className="block text-[13px] font-semibold text-[#EAF1F8] truncate">{sg.label}</span>{sg.sub&&<span className="block text-[11px] text-[rgba(234,241,248,0.5)] truncate">{sg.sub}</span>}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <label className={lbl}>Photos * <span className="normal-case font-medium text-[#6b7d96]">(min {requiredSlots.length}, max 10)</span></label>
      <div className="grid grid-cols-3 gap-2">
        {requiredSlots.map(sl=>(
          <label key={sl.key} className={`relative aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center p-1.5 cursor-pointer overflow-hidden transition ${slots[sl.key]?'border-[#34E0A0]/50':'border-white/15 hover:border-[#5BE7DA]/50'}`}>
            {slots[sl.key]
              ? <img src={slots[sl.key]} alt={sl.label} className="absolute inset-0 w-full h-full object-cover"/>
              : uploading===sl.key
                ? <span className="w-5 h-5 border-2 border-white/25 border-t-[#5BE7DA] rounded-full animate-spin"/>
                : <><Camera size={16} className="text-[#6b7d96] mb-1"/><span className="text-[9px] font-semibold text-[#8da2bd] leading-tight">{sl.label}</span></>}
            {slots[sl.key] && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#34E0A0] text-[#06231f] flex items-center justify-center"><Check size={11}/></span>}
            <input type="file" accept="image/*" className="hidden" onChange={onPickPhoto(sl.key,false)}/>
          </label>
        ))}
        {photos.length < 10 && (
          <label className="aspect-square rounded-xl border-2 border-dashed border-white/15 hover:border-[#5BE7DA]/50 flex flex-col items-center justify-center cursor-pointer">
            {uploading==='extra' ? <span className="w-5 h-5 border-2 border-white/25 border-t-[#5BE7DA] rounded-full animate-spin"/> : <><Plus size={16} className="text-[#6b7d96]"/><span className="text-[9px] font-semibold text-[#8da2bd] mt-1">More</span></>}
            <input type="file" accept="image/*" className="hidden" onChange={onPickPhoto('extra',true)}/>
          </label>
        )}
        {extras.map((u,i)=>(<div key={i} className="relative aspect-square rounded-xl overflow-hidden"><img src={u} alt="" className="w-full h-full object-cover"/><button type="button" onClick={()=>setExtras(p=>p.filter((_,j)=>j!==i))} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={11}/></button></div>))}
      </div>

      <label className={lbl}>How to find it * <span className="normal-case font-medium text-[#6b7d96]">({(f.instructions||'').trim().length}/30 min)</span></label>
      <textarea className={inp} rows={3} placeholder="e.g. Turn right at the red gate, first driveway on the left. Ring the doorbell if the gate is closed." value={f.instructions} onChange={e=>set('instructions',e.target.value)}/>

      <label className={lbl}>Price (£/hour) * <span className="normal-case font-medium text-[#6b7d96]">{f.lat!=null?`· suggested £${suggestedPrice(f.lat,f.lng).toFixed(2)} for this area`:''}</span></label>
      <input className={inp} type="number" min="0" step="0.10" placeholder="2.00" value={f.price_per_hour} onChange={e=>set('price_per_hour',e.target.value)}/>

      <label className={lbl}>Availability *</label>
      <div className="flex flex-wrap gap-2">
        {AVAILABILITY_PRESETS.map(a=>(
          <button key={a} type="button" onClick={()=>set('availability',a)}
            className={`text-xs px-3 py-2 rounded-full border font-semibold transition ${f.availability===a?'teal-grad text-[#06231f] border-transparent':'bg-white/[0.05] border-white/12 text-[#cdd9e8]'}`}>{a}</button>
        ))}
      </div>

      <label className={lbl}>Your mobile number * <span className="normal-case font-medium text-[#6b7d96]">(for booking notifications)</span></label>
      <input className={inp} type="tel" placeholder="+44 7…" value={f.contact_phone} onChange={e=>set('contact_phone',e.target.value)}/>

      <label className={lbl}>Description (optional)</label>
      <textarea className={inp} rows={2} placeholder="Anything else drivers should know" value={f.description} onChange={e=>set('description',e.target.value)}/>

      {/* Live requirements checklist */}
      <div className="mt-5 rounded-2xl bg-white/[0.04] border border-white/10 p-4">
        <p className="font-display font-bold text-[13px] text-[#EAF1F8] mb-2">Ready to publish?</p>
        {canPublish
          ? <p className="text-[13px] text-[#6BEFB9] font-semibold">✓ All requirements met{hostType==='organization'?' — goes to review on submit':''}</p>
          : <ul className="space-y-1">{missing.map((m,i)=>(<li key={i} className="text-[12.5px] text-[#FFD27A]">✗ {m}</li>))}</ul>}
      </div>

      {err && <p className="text-red-300 text-xs mt-3 bg-red-500/12 border border-red-400/40 rounded-xl px-3 py-2.5">{err}</p>}

      <div className="flex gap-2.5 mt-4">
        <button type="button" onClick={()=>saveDraft(false).then(id=>id&&setErr(''))} disabled={busy}
          className="flex-1 py-3 rounded-2xl font-bold text-sm bg-white/8 border border-white/15 text-[#EAF1F8] disabled:opacity-50">
          Save draft
        </button>
        <button type="button" onClick={publish} disabled={!canPublish||busy}
          title={canPublish?'':'Missing: '+missing.join(', ')}
          className="flex-[2] py-3 rounded-2xl font-display font-bold text-sm text-[#06231f] btn-teal disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? 'Publishing…' : hostType==='organization' ? 'Submit for review' : 'Publish listing'}
        </button>
      </div>
    </div>
  );
};

const SpacesTab = ({ user, isPremium, onUpgrade }) => {
  const [view,      setView]      = useState('browse');
  const [listings,  setListings]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [submitted, setSubmitted] = useState(null);   // {hostType, status}
  const [filter,    setFilter]    = useState('all');
  const [needsFix,  setNeedsFix]  = useState([]);      // own listings flagged needs_update

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isSupabaseEnabled) { setLoading(false); return; }
      const { data } = await supabase
        .from('rental_listings')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(50);
      if (active) { setListings(data || []); setLoading(false); }
      // §6 grace-period banner: the host's own listings flagged needs_update
      if (user?.id) {
        const { data: mine } = await supabase.from('rental_listings')
          .select('id,title,host_type,photos,instructions')
          .eq('owner_id', user.id).eq('needs_update', true);
        if (active) setNeedsFix(mine || []);
      }
    })();
    return () => { active = false; };
  }, [view]);

  const filtered = filter === 'all' ? listings
    : filter === 'ev'  ? listings.filter(l => l.amenities?.includes('ev_charging'))
    : listings.filter(l => l.space_type === filter);

  if (view === 'list') {
    if (submitted) {
      const pending = submitted.status === 'pending_approval';
      return (
        <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center pb-28">
          <div className="w-16 h-16 bg-[#34E0A0]/15 rounded-full flex items-center justify-center mb-4">
            {pending ? <Clock size={28} className="text-[#FFD27A]"/> : <Check size={28} className="text-[#6BEFB9]"/>}
          </div>
          <h3 className="font-display font-bold text-[#EAF1F8] text-lg mb-2">{pending ? 'Submitted for review' : 'Space listed!'}</h3>
          <p className="text-[#8da2bd] text-sm mb-5 max-w-xs leading-relaxed">
            {pending
              ? 'Thanks — we review organization listings within 24 hours before they go live. We\u2019ll email you as soon as it\u2019s approved.'
              : 'Your listing is now live. Drivers can contact you directly.'}
          </p>
          <button onClick={() => { setSubmitted(null); setView('browse'); }}
            className="btn-teal text-[#06231f] font-bold px-6 py-2.5 rounded-2xl text-sm transition">
            Browse Spaces
          </button>
        </div>
      );
    }
    return <ListSpaceForm user={user} onBack={() => setView('browse')} onSuccess={(hostType,status) => setSubmitted({hostType,status})}/>;
  }

  const FILTERS = [
    { id:'all',      label:'All'        },
    { id:'driveway', label:'Driveways'  },
    { id:'garage',   label:'Garages'    },
    { id:'covered',  label:'Covered'    },
    { id:'ev',       label:'EV Charging'},
  ];

  return (
    <div className="p-4 pb-28">
      {needsFix.map(l=>{
        const minP = l.host_type==='organization' ? 5 : 3;
        const short = Math.max(0, minP - (l.photos?.length||0));
        return (
          <div key={l.id} className="flex items-start gap-2.5 bg-[#FFC24B]/10 border border-[#FFC24B]/30 text-[#FFD27A] text-xs px-3.5 py-3 rounded-2xl mb-3">
            <Info size={14} className="mt-0.5 flex-shrink-0"/>
            <span className="flex-1"><strong className="text-[#EAF1F8]">{l.title}</strong>: {short>0?`add ${short} more photo${short!==1?'s':''}`:'update the missing details'} to keep your listing visible for the Fleadh. 14-day grace period, then it\u2019s hidden until updated.</span>
          </div>
        );
      })}
      <div className="bg-gradient-to-br from-[#5BE7DA] to-indigo-600 rounded-2xl p-5 mb-5 text-white">
        <div className="flex items-center gap-2 mb-1">
          <Key size={18}/>
          <h2 className="font-black text-xl">Private Spaces</h2>
        </div>
        <p className="text-blue-100 text-sm mb-4">Rent a driveway, garage or home EV charger from a local — cheaper than car parks, guaranteed spot.</p>
        <div className="flex gap-2">
          <button onClick={() => setView('list')}
            className="bg-[#0e1a2c] text-[#5BE7DA] font-bold text-sm px-4 py-2 rounded-xl hover:bg-[#2ED3C6]/10 transition">
            + List Your Space
          </button>
          <div className="flex-1 text-right">
            <span className="text-blue-200 text-xs">{listings.length} {listings.length === 1 ? 'space' : 'spaces'} available</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 no-scrollbar">
        {FILTERS.map(({id, label}) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition
              ${filter === id ? 'bg-[#5BE7DA] text-[#06231f] border-[#5BE7DA]' : 'bg-[#0e1a2c] text-[#8da2bd] border-white/12 hover:border-white/15'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-[#0e1a2c] rounded-2xl overflow-hidden shadow-sm border border-white/10 animate-pulse">
              <div className="h-36 bg-white/10"/>
              <div className="p-4 space-y-2">
                <div className="h-4 bg-white/10 rounded w-3/4"/>
                <div className="h-3 bg-white/10 rounded w-1/2"/>
                <div className="h-8 bg-white/10 rounded-xl mt-3"/>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-[#2ED3C6]/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🅿️</span>
          </div>
          <h3 className="font-bold text-[#cdd9e8] mb-2">
            {listings.length === 0 ? 'No listings yet' : 'No matches for this filter'}
          </h3>
          <p className="text-[#6b7d96] text-sm mb-5">
            {listings.length === 0
              ? 'Be the first to list a space in your area!'
              : 'Try a different filter above.'}
          </p>
          {listings.length === 0 && (
            <button onClick={() => setView('list')}
              className="bg-[#5BE7DA] text-[#06231f] font-bold px-6 py-2.5 rounded-2xl text-sm hover:bg-blue-600 transition">
              List Your Space
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(l => <ListingCard key={l.id} listing={l}/>)}
        </div>
      )}
    </div>
  );
};

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id:'search',     label:'Search',     Icon:Search    },
  { id:'nearby',     label:'Nearby',     Icon:Crosshair },
  { id:'spaces',     label:'Spaces',     Icon:Key       },
  { id:'add',        label:'Add Spot',   Icon:Plus      },
];

// ── Main App ──────────────────────────────────────────────────────────────────
// ── Master-account analytics dashboard ───────────────────────────────────────
const AdminOverlay = ({ onClose }) => {
  const [state, setState] = useState({ loading: true });
  const [refresh, setRefresh] = useState(0);
  const [acting, setActing] = useState(null);
  const act = async (action, id) => {
    let reason;
    if (action === 'reject') {
      reason = window.prompt('Reason for rejection (sent to the host by email):');
      if (!reason || !reason.trim()) return;
    }
    setActing(id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const r = await apiFetch('/api/admin', { method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body: JSON.stringify({ action, id, reason }) });
      if (r.ok) setRefresh(x=>x+1);
      else { const d = await r.json().catch(()=>({})); alert(d.error || 'Action failed'); }
    } catch (e) { alert(e.message || 'Action failed'); }
    setActing(null);
  };
  useEffect(() => {
    (async () => {
      try {
        let token = null;
        if (isSupabaseEnabled) {
          const { data } = await supabase.auth.getSession();
          token = data?.session?.access_token || null;
        }
        if (!token) { setState({ loading:false, error:'Sign in with the master account (Supabase login) to load analytics.' }); return; }
        const r = await apiFetch('/api/admin', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json().catch(()=>({}));
        if (!r.ok) { setState({ loading:false, error: d.error || `Request failed (${r.status})` }); return; }
        setState({ loading:false, data:d });
      } catch (e) { setState({ loading:false, error: e.message || 'Failed to load' }); }
    })();
  }, [refresh]);
  const d = state.data;
  const Tile = ({ label, value, accent }) => (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5 text-center">
      <p className="font-display font-extrabold text-2xl leading-none" style={accent?{color:accent}:{}}>{value}</p>
      <p className="text-[10px] font-semibold text-[#6b7d96] mt-1.5">{label}</p>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[85] overflow-auto" style={{background:'var(--bg-solid)'}}>
      <div className="mx-auto" style={{maxWidth:680}}>
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-4 border-b border-white/10" style={{background:'var(--surface-solid)', paddingTop:'calc(env(safe-area-inset-top) + 14px)'}}>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-white/8 border border-white/15 flex items-center justify-center text-[#EAF1F8] active:scale-90 transition"><X size={16}/></button>
          <div>
            <h2 className="font-display font-bold text-lg text-[#EAF1F8] leading-tight">Admin dashboard</h2>
            <p className="text-[11px] text-[rgba(234,241,248,0.5)]">Master account · build {new Date(__BUILD_TIME__).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</p>
          </div>
        </div>
        <div className="px-4 py-5 pb-16 space-y-5">
          {state.loading && <p className="text-sm text-[#8da2bd] py-10 text-center">Loading analytics…</p>}
          {state.error && (
            <div className="text-sm text-[#FFD27A] bg-[#FFC24B]/10 border border-[#FFC24B]/25 rounded-2xl px-4 py-3.5 leading-relaxed">{state.error}</div>
          )}
          {d && !d.configured && (
            <div className="text-sm text-[#FFD27A] bg-[#FFC24B]/10 border border-[#FFC24B]/25 rounded-2xl px-4 py-3.5 leading-relaxed">
              Almost there — add <strong className="text-[#EAF1F8]">SUPABASE_SERVICE_ROLE_KEY</strong> to the Vercel project env (Supabase → Settings → API → service_role) to unlock user analytics.
            </div>
          )}
          {d?.configured && (
            <>
              <div>
                <h3 className="font-display font-bold text-[13px] text-[#EAF1F8] uppercase tracking-widest mb-2.5">Users</h3>
                <div className="grid grid-cols-4 gap-2">
                  <Tile label="Total" value={d.users.total} accent="#5BE7DA"/>
                  <Tile label="New · 7d" value={d.users.last7} accent="#34E0A0"/>
                  <Tile label="New · 30d" value={d.users.last30}/>
                  <Tile label="Active · 7d" value={d.users.activeLast7}/>
                </div>
              </div>
              {(d.pending?.length > 0) && (
                <div>
                  <h3 className="font-display font-bold text-[13px] text-[#FFD27A] uppercase tracking-widest mb-2.5">⏳ Organization listings awaiting approval ({d.pending.length})</h3>
                  <div className="space-y-3">
                    {d.pending.map(l=>(
                      <div key={l.id} className="glass rounded-2xl p-4">
                        <p className="font-display font-bold text-[15px] text-[#EAF1F8]">{l.title}</p>
                        <p className="text-[12px] text-[rgba(234,241,248,0.55)] mt-0.5">{l.org_name} · {l.org_type} · reg: {l.org_registration}</p>
                        <p className="text-[12px] text-[rgba(234,241,248,0.55)]">{l.address} · {l.spaces} spaces · £{l.price_per_hour}/hr · {l.availability}</p>
                        <p className="text-[12px] text-[rgba(234,241,248,0.55)]">Access: {l.access_contact_name} ({l.access_contact_phone}) — {l.access_method}</p>
                        <p className="text-[12px] text-[rgba(234,241,248,0.55)]">Host: {l.contact_email} · {l.contact_phone}</p>
                        {(l.photos?.length > 0) && (
                          <div className="flex gap-1.5 mt-2.5 overflow-x-auto no-scrollbar">
                            {l.photos.map((u,i)=>(<a key={i} href={u} target="_blank" rel="noreferrer" className="flex-shrink-0"><img src={u} alt="" className="w-16 h-16 object-cover rounded-lg border border-white/10"/></a>))}
                          </div>
                        )}
                        <div className="flex gap-2 mt-3">
                          <button onClick={()=>act('approve', l.id)} disabled={acting===l.id}
                            className="flex-1 py-2.5 rounded-xl font-bold text-xs text-[#06231f] btn-teal disabled:opacity-50">✓ Approve & publish</button>
                          <button onClick={()=>act('reject', l.id)} disabled={acting===l.id}
                            className="flex-1 py-2.5 rounded-xl font-bold text-xs text-red-300 bg-red-500/12 border border-red-400/40 disabled:opacity-50">✗ Reject…</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h3 className="font-display font-bold text-[13px] text-[#EAF1F8] uppercase tracking-widest mb-2.5">Latest signups</h3>
                <div className="glass rounded-2xl divide-y divide-white/5 overflow-hidden">
                  {d.users.latest.length === 0 && <p className="text-sm text-[#8da2bd] px-4 py-4">No signups yet.</p>}
                  {d.users.latest.map((u,i)=>(
                    <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full teal-grad text-[#06231f] font-bold text-xs flex items-center justify-center flex-shrink-0">{(u.name||u.email||'?').charAt(0).toUpperCase()}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-[#EAF1F8] truncate">{u.name || u.email}</span>
                        {u.name && <span className="block text-[11px] text-[rgba(234,241,248,0.5)] truncate">{u.email}</span>}
                      </span>
                      <span className="text-[11px] text-[rgba(234,241,248,0.45)] flex-shrink-0">{new Date(u.created).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-display font-bold text-[13px] text-[#EAF1F8] uppercase tracking-widest mb-2.5">Space listings</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Tile label="Total listings" value={d.listings.total} accent="#C9A7FF"/>
                  <Tile label="Latest shown" value={d.listings.latest.length}/>
                </div>
                {d.listings.latest.length > 0 && (
                  <div className="glass rounded-2xl divide-y divide-white/5 overflow-hidden mt-2">
                    {d.listings.latest.map((l,i)=>(
                      <div key={i} className="px-4 py-2.5">
                        <p className="text-[13px] font-semibold text-[#EAF1F8] truncate">{l.title}</p>
                        <p className="text-[11px] text-[rgba(234,241,248,0.5)] truncate">{l.address} · {new Date(l.created_at).toLocaleDateString('en-GB')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          <div>
            <h3 className="font-display font-bold text-[13px] text-[#EAF1F8] uppercase tracking-widest mb-2.5">App data</h3>
            <div className="grid grid-cols-3 gap-2">
              <Tile label="Parking spots" value={ALL_SPOTS.length} accent="#5BE7DA"/>
              <Tile label="Hidden gems" value={ALL_SPOTS.filter(s=>s.badge==='hidden_gem').length} accent="#C9A7FF"/>
              <Tile label="Towns covered" value={CITIES.length}/>
            </div>
          </div>
          <div className="text-[12px] leading-relaxed text-[#8da2bd] bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-3.5">
            <strong className="text-[#EAF1F8]">Traffic analytics:</strong> page views, visitors and referrers are tracked by Vercel Web Analytics — open your Vercel dashboard → <em>parkeasy</em> → Analytics. (Enable it once under the project's Analytics tab.)
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Cookie consent ────────────────────────────────────────────────────────────
const CookieBanner = ({ onChoice }) => (
  <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-24px)]" style={{maxWidth:640}}>
    <div className="glass rounded-2xl p-4">
      <p className="text-sm font-bold text-[#EAF1F8] font-display mb-1">Cookies &amp; privacy</p>
      <p className="text-xs text-[rgba(234,241,248,0.6)] leading-relaxed mb-3">
        We use essential storage to make ParkEasy work, plus optional analytics to improve it. You choose.
      </p>
      <div className="flex gap-2">
        <button onClick={()=>onChoice('all')}
          className="flex-1 text-[#06231f] text-xs font-bold py-2.5 rounded-xl btn-teal active:scale-95 transition">Accept all</button>
        <button onClick={()=>onChoice('essential')}
          className="flex-1 bg-white/8 border border-white/15 text-[#cdd9e8] text-xs font-bold py-2.5 rounded-xl hover:bg-white/12 active:scale-95 transition">Reject all</button>
      </div>
    </div>
  </div>
);

// ── Sponsor slot (advertising) ────────────────────────────────────────────────
const SponsorCard = ({ onAdvertise }) => (
  <div className="glass rounded-2xl overflow-hidden" style={{borderLeft:'4px solid #FFC24B'}}>
    <div className="p-4 flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center bg-[#FFC24B]/15 border border-[#FFC24B]/30 text-xl">📣</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-bold text-[#EAF1F8] text-sm">Your business here</p>
          <span className="text-[9px] font-bold uppercase tracking-wide text-[#FFD27A] bg-[#FFC24B]/15 px-1.5 py-0.5 rounded">Sponsored</span>
        </div>
        <p className="text-xs text-[rgba(234,241,248,0.55)] mt-0.5">Reach drivers searching near you — from £25/mo.</p>
      </div>
      <button onClick={onAdvertise} className="text-[#06231f] text-xs font-bold px-3 py-2 rounded-xl btn-teal active:scale-95 transition whitespace-nowrap">Advertise</button>
    </div>
  </div>
);

// ── Contact / feedback form (emails CONTACT_EMAIL via /api/notify) ────────────
const ContactForm = () => {
  const [f, setF] = useState({ name:'', email:'', message:'' });
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  const send = async () => {
    if (!f.message.trim() || !f.email.trim()) { setState('error'); return; }
    setState('sending');
    const ok = await notify('contact', f);
    setState(ok ? 'done' : 'error');
  };
  if (state === 'done') return (
    <div className="mt-4 p-4 rounded-2xl bg-[#34E0A0]/12 border border-[#34E0A0]/30 text-[#6BEFB9] text-sm font-semibold">
      ✓ Thanks — your message is on its way. We&apos;ll reply within 2 working days.
    </div>
  );
  const inp = "w-full bg-white/[0.06] border border-white/12 rounded-xl px-3 py-2.5 text-sm text-[#EAF1F8] placeholder-[rgba(234,241,248,0.45)] focus:outline-none focus:ring-2 focus:ring-[#2ED3C6]/60 mt-2";
  return (
    <div className="mt-4 space-y-1">
      <input className={inp} placeholder="Your name (optional)" value={f.name} onChange={e=>s('name',e.target.value)}/>
      <input className={inp} type="email" placeholder="Your email" value={f.email} onChange={e=>s('email',e.target.value)}/>
      <textarea className={inp} rows={4} placeholder="Your message, feedback, or a spot to add…" value={f.message} onChange={e=>s('message',e.target.value)}/>
      {state==='error' && <p className="text-red-300 text-xs pt-1">Please add your email and a message, then try again.</p>}
      <button onClick={send} disabled={state==='sending'}
        className="mt-2 w-full btn-teal text-[#06231f] font-bold py-3 rounded-xl text-sm disabled:opacity-60">
        {state==='sending' ? 'Sending…' : 'Send message'}
      </button>
    </div>
  );
};

// ── Info / legal pages (Privacy, About, Contact, Advertise) ───────────────────
const INFO_PAGES = {
  about: {
    title: 'About ParkEasy', Icon: Info,
    body: (
      <>
        <p>ParkEasy helps drivers across Northern Ireland find where locals actually park — street spots, hidden gems, official car parks and live prices — all in one fast, free app.</p>
        <p>It started in Belfast as a way to share the spots locals know and tourists never find, and now covers towns and cities right across NI. Every spot is community-powered: people add the places they use and confirm whether they&apos;re still accurate.</p>
        <p>We also let people rent out private driveways and spaces, and help local businesses reach customers who&apos;d otherwise drive past over parking worries.</p>
        <p className="text-[rgba(234,241,248,0.5)]">Built by a local solo founder. If it saved you a lap of the block, tell a friend.</p>
      </>
    ),
  },
  contact: {
    title: 'Contact us', Icon: Mail,
    body: (
      <>
        <p>Questions, a spot to add, a correction, or a business enquiry? We&apos;d love to hear from you — drop us a message below.</p>
        <ContactForm/>
        <p className="text-xs text-[rgba(234,241,248,0.45)] pt-1">We aim to reply within 2 working days. For wrong or out-of-date spots, the quickest fix is the &ldquo;Changed&rdquo; button on any spot card.</p>
      </>
    ),
  },
  privacy: {
    title: 'Privacy policy', Icon: Shield,
    body: (
      <>
        <p className="text-[rgba(234,241,248,0.5)] text-xs">Last updated: June 2026</p>
        <p>ParkEasy is built to need as little of your data as possible.</p>
        <p><strong className="text-[#EAF1F8]">What we store on your device:</strong> your saved spots, ratings and preferences are kept in your browser&apos;s local storage. They never leave your device unless you create an account.</p>
        <p><strong className="text-[#EAF1F8]">Accounts:</strong> if you sign up, your email and the spots you add are stored securely with our backend provider (Supabase) so you can access them across devices.</p>
        <p><strong className="text-[#EAF1F8]">Location:</strong> we only request your location when you tap &ldquo;near me&rdquo;, and we use it solely to show nearby parking. We don&apos;t track or store your movements.</p>
        <p><strong className="text-[#EAF1F8]">Analytics &amp; cookies:</strong> optional, and only with your consent via the cookie banner. Reject all and the app still works fully.</p>
        <p><strong className="text-[#EAF1F8]">Payments:</strong> Premium subscriptions are handled by Stripe; we never see your card details.</p>
        <p><strong className="text-[#EAF1F8]">Your rights:</strong> email <a className="text-[#5BE7DA] underline" href="mailto:hello@parkeasy.uk">hello@parkeasy.uk</a> any time to access or delete your data.</p>
      </>
    ),
  },
  advertise: {
    title: 'Advertise with us', Icon: Megaphone,
    body: (
      <>
        <p>Thousands of drivers use ParkEasy to decide where to park — and where to park is where they shop, eat and visit. Put your business in front of them at the exact moment they&apos;re choosing.</p>
        <p><strong className="text-[#EAF1F8]">What you get:</strong></p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>A clearly-labelled &ldquo;Sponsored&rdquo; slot shown to drivers searching near you</li>
          <li>Your pin highlighted on the map with your offer</li>
          <li>A spot on the Local businesses tab</li>
        </ul>
        <p><strong className="text-[#EAF1F8]">Founding-sponsor pricing:</strong> £25–40/month, and your first month is free. Limited slots per area so it stays useful, not cluttered.</p>
        <p>Interested? Email <a className="text-[#5BE7DA] underline" href="mailto:hello@parkeasy.uk?subject=Advertising%20with%20ParkEasy">hello@parkeasy.uk</a> and we&apos;ll set you up.</p>
      </>
    ),
  },
};

const InfoOverlay = ({ page, onClose }) => {
  const p = INFO_PAGES[page];
  if (!p) return null;
  const { Icon } = p;
  return (
    <div className="fixed inset-0 z-[70] flex flex-col" style={{background:'var(--bg-solid)'}}>
      <div className="sticky top-0 flex items-center gap-3 px-4 py-4 border-b border-white/10" style={{paddingTop:'calc(env(safe-area-inset-top) + 14px)',background:'var(--surface-solid)'}}>
        <button onClick={onClose} aria-label="Back" className="w-9 h-9 rounded-full bg-white/8 border border-white/15 flex items-center justify-center text-[#EAF1F8] active:scale-90 transition"><X size={16}/></button>
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-[#5BE7DA]"/>
          <h2 className="font-display font-bold text-[#EAF1F8] text-lg">{p.title}</h2>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-5 py-6" style={{maxWidth:680,margin:'0 auto',width:'100%'}}>
        <div className="space-y-4 text-sm leading-relaxed text-[#cdd9e8] [&_p]:leading-relaxed">{p.body}</div>
        <p className="mt-8 text-xs text-[rgba(234,241,248,0.4)]">ParkEasy · Northern Ireland · parkeasy.uk</p>
      </div>
    </div>
  );
};

const Footer = ({ onOpen }) => (
  <footer className="px-4 pt-2 pb-6 text-center">
    <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-1.5 text-xs text-[rgba(234,241,248,0.5)]">
      {[['about','About'],['privacy','Privacy'],['contact','Contact'],['advertise','Advertise']].map(([id,label])=>(
        <button key={id} onClick={()=>onOpen(id)} className="hover:text-[#5BE7DA] transition font-medium">{label}</button>
      ))}
    </div>
    <p className="text-[10px] text-[rgba(234,241,248,0.3)] mt-3">© 2026 ParkEasy · Made in Northern Ireland</p>
    <p className="text-[9.5px] text-[rgba(234,241,248,0.25)] mt-1">Version {new Date(__BUILD_TIME__).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
  </footer>
);

export default function App() {
  const [tab,           setTab]           = useState('search');
  const [user,          setUser]          = useState(()=>ls.get('pe_user', null));
  const [saved,         setSaved]         = useState(()=>new Set(ls.get('pe_saved', [])));
  const [ratings,       setRatings]       = useState(()=>ls.get('pe_ratings', {}));
  const [showWelcome,   setShowWelcome]   = useState(()=>!ls.get('pe_user',null) && !ls.get('pe_skipped',false));
  const [showUserMenu,  setShowUserMenu]  = useState(false);
  const [showBizModal,  setShowBizModal]  = useState(false);
  // Premium is either lifetime/subscription (pe_premium) or time-limited
  // (pe_premium_until) — the reward for an approved community hidden gem.
  const [isPremium,     setIsPremium]     = useState(()=>ls.get('pe_premium', false) || ls.get('pe_premium_until', 0) > Date.now());
  const [rewardUntil,   setRewardUntil]   = useState(null);   // timestamp → shows the congrats sheet
  const [showPricing,   setShowPricing]   = useState(false);
  const [infoPage,      setInfoPage]      = useState(null);
  const [cookieChoice,  setCookieChoice]  = useState(()=>ls.get('pe_cookie', null));
  const [detailSpot,    setDetailSpot]    = useState(null);

  // Deep links: #s=<id> opens that spot; the hash tracks the open detail sheet.
  // Gated spots can't be opened via a shared link on the free tier — show the
  // pricing sheet instead so exact locations never leak.
  useEffect(() => {
    const m = location.hash.match(/#s=(\d+)/);
    if (m) {
      const sp = ALL_SPOTS.find(x => x.id === +m[1]);
      if (sp) {
        if (!isPremium && isGated(sp)) setShowPricing(true);
        else setDetailSpot(sp);
      }
    }
  }, []);
  useEffect(() => {
    try {
      if (detailSpot) history.replaceState(null, '', '#s=' + detailSpot.id);
      else if (location.hash.startsWith('#s=')) history.replaceState(null, '', location.pathname + location.search);
    } catch { /* ignore */ }
  }, [detailSpot]);
  const [votes,          setVotes]          = useState(()=>ls.get('pe_votes', {}));
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstall,    setShowInstall]    = useState(false);
  const [showIOSGuide,   setShowIOSGuide]   = useState(false);
  const [city,           setCity]           = useState(()=>ls.get('pe_city', 'belfast'));
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [userSpots,      setUserSpots]      = useState(()=>ls.get('pe_user_spots', []));
  const [parkSession,    setParkSession]    = useState(()=>ls.get('pe_session', null));
  const [showSession,    setShowSession]    = useState(false);
  const [nowTs,          setNowTs]          = useState(()=>Date.now());
  const [theme,          setTheme]          = useState(()=>ls.get('pe_theme', 'dark'));
  const [showEvent,      setShowEvent]      = useState(false);
  const [showAdmin,      setShowAdmin]      = useState(false);

  // Apply the theme to the document root and keep the browser chrome colour
  // in sync so the status bar matches in both modes.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    ls.set('pe_theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#F5F7FA' : '#0A0F1A');
  }, [theme]);

  const isIOS        = /ipad|iphone|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;

  const currentCity = CITIES.find(c => c.id === city) || CITIES[0];
  // Seeded spots for the city + any community spots the user has added there.
  const citySpots   = useMemo(
    () => [...userSpots.filter(s => s.city === currentCity.id), ...getCitySpots(currentCity.id)],
    [userSpots, currentCity.id]
  );
  // Everything addressable by id (used by Saved, which can hold community spots too).
  const allSpots    = useMemo(() => [...userSpots, ...Object.values(CITY_SPOTS).flat()], [userSpots]);

  const changeCity = (id) => {
    setCity(id);
    ls.set('pe_city', id);
    setShowCityPicker(false);
  };

  // Real accounts: restore any existing session and react to login/logout.
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    const applySession = (session) => {
      if (session) {
        const prev = ls.get('pe_user', null);
        const u = { ...sessionToUser(session), spotsAdded: prev?.spotsAdded || 0 };
        setUser(u); ls.set('pe_user', u); setShowWelcome(false);
      } else {
        setUser(null); ls.set('pe_user', null);
      }
    };
    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => applySession(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('premium') === 'success') {
      setIsPremium(true);
      ls.set('pe_premium', true);
      window.history.replaceState({}, '', window.location.pathname);
    }
    // Hidden-gem reward: when a community spot is approved, the founder emails
    // the submitter this link — it activates 1 month of Premium. A second
    // approval extends from whatever is left, so months stack.
    if (p.get('reward') === 'gem30') {
      const base = Math.max(ls.get('pe_premium_until', 0), Date.now());
      const until = base + 30 * 86400000;
      ls.set('pe_premium_until', until);
      setIsPremium(true);
      setRewardUntil(until);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // VIP emails (e.g. the owner's own account) are always Premium, on any device.
  useEffect(() => {
    const email = user?.email?.trim().toLowerCase();
    if (email && VIP_EMAILS.some(v => v.toLowerCase() === email)) {
      setIsPremium(true);
      ls.set('pe_premium', true);
    }
  }, [user]);

  const redeemVipCode = (code) => {
    const ok = code?.trim().toUpperCase() === VIP_CODE;
    if (ok) { setIsPremium(true); ls.set('pe_premium', true); }
    return ok;
  };

  useEffect(() => {
    if (isStandalone) return;
    if (isIOS) { setTimeout(() => setShowInstall(true), 3000); return; }
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); setShowInstall(true); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);


  const handleInstall = async () => {
    if (isIOS) { setShowInstall(false); setShowIOSGuide(true); return; }
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; setDeferredPrompt(null); }
    setShowInstall(false);
  };

  const handleJoin = (userData) => {
    setUser(userData);
    ls.set('pe_user', userData);
    setShowWelcome(false);
  };

  const handleSkip = () => {
    ls.set('pe_skipped', true);
    setShowWelcome(false);
  };

  const handleSignOut = async () => {
    if (isSupabaseEnabled) { try { await supabase.auth.signOut(); } catch { /* ignore */ } }
    setUser(null);
    ls.set('pe_user', null);
    ls.set('pe_skipped', false);
    setShowUserMenu(false);
    setShowWelcome(true);
  };

  // §1: nudge skipped users to sign up at value moments (once per session).
  const promptSignup = () => {
    if (user || sessionStorage.getItem('pe_prompted')) return;
    try { sessionStorage.setItem('pe_prompted', '1'); } catch { /* ignore */ }
    setShowWelcome(true);
  };

  const toggleSave = (id) => {
    promptSignup();
    setSaved(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      ls.set('pe_saved', [...next]);
      return next;
    });
  };

  const rateSpot = (id, val) => {
    setRatings(prev => {
      const next = {...prev};
      next[id]===val ? delete next[id] : (next[id]=val);
      ls.set('pe_ratings', next);
      return next;
    });
  };

  const voteSpot = (id) => {
    promptSignup();
    setVotes(prev => {
      if (prev[id]) return prev;
      const next = { ...prev, [id]: true };
      ls.set('pe_votes', next);
      return next;
    });
  };


  // Parking session timer — tick every second while a session is active.
  useEffect(() => {
    if (!parkSession) return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [parkSession]);

  const startSession = (spot) => {
    const rate = spot.price ? (parseFloat(String(spot.price).match(/([\d.]+)/)?.[1]) || 0) : 0;
    const sess = { spotId: spot.id, name: spot.name, rate, startedAt: Date.now() };
    setParkSession(sess); ls.set('pe_session', sess);
    setDetailSpot(null); setShowSession(true); setNowTs(Date.now());
  };
  const endSession = () => { setParkSession(null); ls.set('pe_session', null); setShowSession(false); };

  const handleSpotAdded = (newSpot) => {
    if (user) {
      const updated = {...user, spotsAdded:(user.spotsAdded||0)+1};
      setUser(updated);
      ls.set('pe_user', updated);
    }
    // If the user pinned a location, show their spot on the map straight away
    // and persist it between sessions. It's still emailed for the official
    // community review (which is what unlocks their free Premium month).
    if (newSpot) {
      const next = [newSpot, ...userSpots];
      setUserSpots(next);
      ls.set('pe_user_spots', next);
      // Make sure the contributor can actually see their new spot: switch to the
      // city it was pinned in (otherwise Search keeps showing the old city).
      if (newSpot.city && newSpot.city !== city) { setCity(newSpot.city); ls.set('pe_city', newSpot.city); }
    }
    // Premium is NOT granted here — only after you review and approve the spot.
    // You email the user a unique link: parkeasy.uk/?premium=success
  };

  return (
    <div className="min-h-screen flex flex-col text-[#EAF1F8]" style={{maxWidth:680,margin:'0 auto',background:'var(--app-grad)'}}>
      {/* ── Modals ── */}
      {showAdmin && <AdminOverlay onClose={()=>setShowAdmin(false)}/>}
      {showEvent && <EventOverlay onClose={()=>setShowEvent(false)} saved={saved} onSave={toggleSave} isPremium={isPremium} onUpgrade={()=>{setShowEvent(false);setShowPricing(true);}} onOpenSpot={setDetailSpot}/>}
      {detailSpot && <SpotDetail spot={detailSpot} saved={saved.has(detailSpot.id)} onSave={toggleSave} rating={ratings[detailSpot.id]} onRate={rateSpot} voted={!!votes?.[detailSpot.id]} onVote={voteSpot} onClose={()=>setDetailSpot(null)} onStartTimer={startSession}/>}
      {showSession && <SessionModal session={parkSession} now={nowTs} onClose={()=>setShowSession(false)} onEnd={endSession}/>}
      {infoPage && <InfoOverlay page={infoPage} onClose={()=>setInfoPage(null)}/>}
      {!cookieChoice && <CookieBanner onChoice={(c)=>{ setCookieChoice(c); ls.set('pe_cookie', c); }}/>}
      {showWelcome  && <WelcomeModal onJoin={handleJoin} onSkip={handleSkip}/>}
      {showBizModal && <BusinessModal onClose={()=>setShowBizModal(false)}/>}
      {showPricing  && <PricingModal isPremium={isPremium} onClose={()=>setShowPricing(false)} onRedeem={redeemVipCode}/>}
      {rewardUntil && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[210] flex items-center justify-center p-4" onClick={()=>setRewardUntil(null)}>
          <div onClick={e=>e.stopPropagation()} className="bg-[#0e1a2c] rounded-3xl w-full max-w-sm p-8 text-center space-y-4 shadow-2xl">
            <p className="text-4xl">🏆</p>
            <h3 className="text-xl font-bold text-[#EAF1F8]">Spot approved — 1 month Premium unlocked!</h3>
            <p className="text-sm text-[#8da2bd] leading-relaxed">
              Thanks for sharing a hidden gem with the community. Every ✨ gem and ⚡ EV charger spot across NI
              is yours until <strong className="text-[#5BE7DA]">{new Date(rewardUntil).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}</strong>.
            </p>
            <button onClick={()=>setRewardUntil(null)} className="w-full btn-teal text-[#06231f] py-3 rounded-xl font-bold active:scale-[0.98] transition">Start exploring ✨</button>
          </div>
        </div>
      )}
      {showIOSGuide && <IOSGuide onClose={()=>setShowIOSGuide(false)}/>}
      {showUserMenu && (
        <UserMenu user={user} spotsAdded={user?.spotsAdded||0} isPremium={isPremium}
          onSignOut={handleSignOut}
          onUpgrade={()=>{setShowUserMenu(false);setShowPricing(true);}}
          onAdmin={isAdminUser(user) ? ()=>{setShowUserMenu(false);setShowAdmin(true);} : undefined}
          onClose={()=>setShowUserMenu(false)}/>
      )}

      {/* ── Header ── */}
      <header style={{background:'var(--header-grad)', paddingTop:'env(safe-area-inset-top)'}} className="sticky top-0 z-50 shadow-xl border-b border-white/5">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'linear-gradient(135deg, #54E6D8 0%, #2ED3C6 100%)', boxShadow:'0 4px 16px rgba(46,211,198,0.5)'}}>
            <MapPin size={20} className="text-[#06231f]" strokeWidth={2.6}/>
          </div>
          <div className="relative min-w-0 flex-1">
            <h1 className="font-display text-white font-extrabold text-[15px] leading-tight tracking-tight whitespace-nowrap">ParkEasy</h1>
            <p className="text-[rgba(234,241,248,0.55)] text-[10px] font-medium truncate whitespace-nowrap">
              Northern Ireland · {ALL_SPOTS.length} spots
            </p>
          </div>

          <div className="ml-auto flex items-center gap-1 flex-shrink-0">
            <button aria-label="Toggle light or dark theme" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 border border-white/15 bg-white/10 text-white hover:bg-white/20">
              {theme==='dark' ? <Sun size={15}/> : <Moon size={15}/>}
            </button>
            <button aria-label="Saved spots" onClick={()=>setTab('saved')}
              className={`relative w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 border border-white/15 ${
                tab==='saved' ? 'text-[#06231f] teal-grad' : 'bg-white/10 text-white hover:bg-white/20'
              }`}>
              <Bookmark size={16} fill={tab==='saved' ? '#06231f' : 'none'}/>
              {saved.size > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 text-[#06231f] text-[9px] font-bold rounded-full flex items-center justify-center px-1 teal-grad">
                  {saved.size}
                </span>
              )}
            </button>
            {!isStandalone && (
              <button onClick={()=>isIOS ? setShowIOSGuide(true) : handleInstall()}
                className="text-[11px] bg-white/10 text-white px-2.5 py-1.5 rounded-full font-semibold hover:bg-white/20 active:scale-95 transition-all border border-white/15 hidden min-[400px]:flex items-center gap-1">
                <Download size={11}/><span className="hidden min-[430px]:inline">Install</span>
              </button>
            )}
            {!isPremium && (
              <button onClick={()=>setShowPricing(true)}
                className="text-[11px] text-[#06231f] px-2 py-1.5 rounded-full font-bold active:scale-95 transition-all btn-teal whitespace-nowrap">
                ★ Premium
              </button>
            )}
            {user ? (
              <button onClick={()=>setShowUserMenu(v=>!v)}
                className="relative w-9 h-9 rounded-full flex items-center justify-center text-[#06231f] font-bold text-sm active:scale-95 transition-all teal-grad">
                {user.name.charAt(0).toUpperCase()}
                {isPremium && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#FFC24B] rounded-full flex items-center justify-center text-[#5a3c00] font-black shadow" style={{fontSize:8}}>★</span>
                )}
              </button>
            ) : (
              <button onClick={()=>setShowWelcome(true)}
                className="text-[11px] bg-white/10 text-white px-2.5 py-1.5 rounded-full font-semibold hover:bg-white/20 active:scale-95 transition-all border border-white/15 whitespace-nowrap">
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Currently-parked timer bar */}
      <ParkBar session={parkSession} now={nowTs} onOpen={()=>setShowSession(true)} onEnd={endSession}/>

      {/* ── Content ── */}
      <main className="flex-1 overflow-auto pb-24">
        {showInstall && !isStandalone && (
          <InstallBanner isIOS={isIOS} onInstall={handleInstall} onDismiss={()=>setShowInstall(false)}/>
        )}
        {tab==='search'     && <SearchTab mode="list" saved={saved} onSave={toggleSave} ratings={ratings} onRate={rateSpot} votes={votes} onVote={voteSpot} isPremium={isPremium} onUpgrade={()=>setShowPricing(true)} citySpots={citySpots} cityCenter={currentCity.center} cityName={currentCity.name} onAdvertise={()=>setInfoPage('advertise')} onOpenSpot={setDetailSpot} onCityDetected={changeCity} onEvent={()=>setShowEvent(true)}/>}
        {tab==='nearby'     && <SearchTab mode="map" saved={saved} onSave={toggleSave} ratings={ratings} onRate={rateSpot} votes={votes} onVote={voteSpot} isPremium={isPremium} onUpgrade={()=>setShowPricing(true)} citySpots={citySpots} cityCenter={currentCity.center} cityName={currentCity.name} onOpenSpot={setDetailSpot} onCityDetected={changeCity} onEvent={()=>setShowEvent(true)}/>}
        {tab==='spaces'     && <SpacesTab user={user} isPremium={isPremium} onUpgrade={()=>setShowPricing(true)}/>}
        {tab==='saved'      && <SavedTab saved={saved} onSave={toggleSave} ratings={ratings} onRate={rateSpot} votes={votes} onVote={voteSpot} allSpots={allSpots} isPremium={isPremium} onUpgrade={()=>setShowPricing(true)} onOpenSpot={setDetailSpot}/>}
        {tab==='add'        && <AddSpotTab user={user} onJoinPrompt={()=>setShowWelcome(true)} onSpotAdded={handleSpotAdded}/>}
        <Footer onOpen={setInfoPage}/>
      </main>

      {/* ── Bottom Navigation ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10" style={{maxWidth:680,margin:'0 auto',background:'var(--float)',backdropFilter:'saturate(180%) blur(24px)',WebkitBackdropFilter:'saturate(180%) blur(24px)',boxShadow:'var(--nav-shadow)'}}>
        <div className="flex" style={{paddingBottom:'env(safe-area-inset-bottom)'}}>
          {TABS.map(({id,label,Icon})=>{
            const active = tab===id;
            const pill   = id==='saved' && saved.size>0 ? saved.size : null;
            return (
              <button key={id} onClick={()=>setTab(id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 mx-1 my-1 rounded-2xl transition-colors ${
                  active ? 'text-[#5BE7DA] bg-[#5BE7DA]/10' : 'text-[rgba(234,241,248,0.45)] hover:text-[rgba(234,241,248,0.7)] active:bg-white/5'
                }`}>
                <div className="relative">
                  <Icon size={22} strokeWidth={active ? 2.5 : 1.8}/>
                  {pill && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 text-[#06231f] text-[9px] font-bold rounded-full flex items-center justify-center px-1 teal-grad">
                      {pill}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-semibold ${active ? 'text-[#5BE7DA]' : 'text-[rgba(234,241,248,0.45)]'}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
