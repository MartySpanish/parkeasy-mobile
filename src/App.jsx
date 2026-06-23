import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapPin, Search, Crosshair, Plus, Building2, Navigation,
  Bookmark, Camera, Check, X, ChevronRight, Share2,
  Map, Star, Clock, Car, Info, LogOut, User, Filter, Smartphone, Download,
  Zap, Timer, Globe, Receipt,
} from 'lucide-react';
import { supabase, isSupabaseEnabled, sessionToUser } from './supabase';

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

const BELFAST_CENTER = [54.5973, -5.9301];

// ── Notification email (FormSubmit — free, no config needed) ──────────────────
const notifyAdmin = async (name, email) => {
  try {
    await fetch('https://formsubmit.co/ajax/martinrooney250@gmail.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: `🅿 New ParkEasy member: ${name}`,
        Name: name,
        Email: email,
        Message: `New sign-up on ParkEasy Belfast!\n\nName: ${name}\nEmail: ${email}\nTime: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}`,
        _honey: '',
        _captcha: 'false',
      }),
    });
  } catch { /* silent fail — app still works */ }
};

// ── Stripe links ──────────────────────────────────────────────────────────────
const STRIPE_MONTHLY = 'https://buy.stripe.com/00w4gscgJ6QoahjcTU0kE01';
const STRIPE_ANNUAL  = 'https://buy.stripe.com/5kQ6oA1C5eiQ0GJg660kE00';

// ── Free / VIP Premium access ───────────────────────────────────────────────
// Accounts that sign in with one of these emails are always Premium, on any
// device — no Stripe checkout needed. Add more emails here as needed.
const VIP_EMAILS = ['martinrooney3@hotmail.com'];
// Shared invite code you can hand out to influencers etc. for free Premium.
// This lives in the client bundle, so treat it as a "thank you" perk rather
// than a secure paywall — anyone determined could find it in the page source.
const VIP_CODE = 'PARKEASY-VIP';

// ── Seed data ─────────────────────────────────────────────────────────────────
const SPOTS = [
  { id:1,  name:'Directly outside — Gransha Grill',   near:'Gransha Grill',    tags:['gransha grill','gransha road'],                                          badge:'free',       dist:0.00, walk:'Right outside', restriction:'No restrictions',              notes:'Park right outside the door — 2–3 cars fit easily. Free all day, no signage spotted.', lat:54.5825, lng:-5.9758, by:'GranshaLocal',        votes:61, photo:null, price:null,      spaces:3    },
  { id:2,  name:'Gransha Road Lay-by (north side)',    near:'Gransha Grill',    tags:['gransha grill','gransha road'],                                          badge:'free',       dist:0.04, walk:'1 min',          restriction:'Free all day',                 notes:'Wider lay-by fits 4+ cars, 1 min walk back. Locals use this daily — never seen a warden.', lat:54.5830, lng:-5.9762, by:'RegularDiner',        votes:44, photo:null, price:null,      spaces:5    },
  { id:3,  name:'Side road off Gransha Road',          near:'Gransha Grill',    tags:['gransha grill','gransha'],                                              badge:'hidden_gem', dist:0.07, walk:'2 min',          restriction:'Evenings & weekends fine',     notes:'Quiet residential street, no wardens ever spotted. Walk right back to the Grill.', lat:54.5835, lng:-5.9768, by:'ParkingPro_BT',      votes:29, photo:null,                                                                                          price:null,      spaces:8    },
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
  { id:36, name:'Ormeau Embankment riverside',         near:'Ormeau Road',       tags:['ormeau embankment','lagan','riverside','ormeau','south belfast','free parking'],    badge:'hidden_gem', dist:0.20, walk:'5 min', restriction:'Free all day', notes:'Completely free riverside parking off Ormeau Embankment. Walk along the Lagan towpath to the Gasworks or city centre. Locals keep this quiet!', lat:54.5882, lng:-5.9185, by:'LagansideLad', votes:67, photo:null, price:null, spaces:null },
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
  { id:54, name:'Lagan Towpath riverside (free)',      near:'Lagan Towpath',     tags:['lagan towpath','riverside','lagan','south belfast','free parking'],                 badge:'hidden_gem', dist:0.00, walk:'Riverside start', restriction:'Free all day',                notes:'Completely free parking along the Lagan towpath riverside roads. Walk or cycle along the Lagan from here. Popular with locals but rarely on parking apps.', lat:54.5810, lng:-5.9155, by:'LaganLocal', votes:58, photo:null, price:null, spaces:null },
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
];

// ── Cities ───────────────────────────────────────────────────────────────────
// Belfast has full community-sourced spot data. Other towns/cities are listed so
// people can pick their area and be the first to add local spots. Each city has a
// region so the picker can group them (Northern Ireland, Scotland, …).
const CITIES = [
  { id:'belfast',      name:'Belfast',           center:[54.5973,-5.9301], region:'Northern Ireland' },
  { id:'derry',        name:'Derry~Londonderry', center:[54.9966,-7.3086], region:'Northern Ireland' },
  { id:'lisburn',      name:'Lisburn',           center:[54.5162,-6.0581], region:'Northern Ireland' },
  { id:'newtownabbey', name:'Newtownabbey',      center:[54.6601,-5.9094], region:'Northern Ireland' },
  { id:'bangor',       name:'Bangor',            center:[54.6604,-5.6694], region:'Northern Ireland' },
  { id:'newry',        name:'Newry',             center:[54.1751,-6.3402], region:'Northern Ireland' },
  { id:'antrim',       name:'Antrim',            center:[54.7140,-6.2110], region:'Northern Ireland' },
  { id:'perth',        name:'Perth',             center:[56.3950,-3.4308], region:'Scotland' },
];

// Region groupings for the city picker, in display order.
const CITY_REGIONS = [...new Set(CITIES.map(c => c.region))];

const getCitySpots = (cityId) => cityId === 'belfast' ? SPOTS : [];

// Welcome-screen stats — derived from SPOTS so they never go stale as spots are added.
const WELCOME_STATS = [
  ['🟢', SPOTS.length, 'Spots'],
  ['💎', SPOTS.filter(s => s.badge === 'hidden_gem').length, 'Hidden Gems'],
  ['🅿', SPOTS.filter(s => s.badge === 'official').length, 'Car Parks'],
];

const BUSINESSES = [
  { id:1,  name:"Tommy's Barber",       area:'Glen Road',         addr:'245 Glen Road, West Belfast BT11',    cat:'Barber',         icon:'✂️',  key:'glen road barber',   lat:54.5935, lng:-6.0012 },
  { id:2,  name:'Gransha Grill',        area:'Hannahstown',       addr:'Gransha Road, BT17',                  cat:'Restaurant',     icon:'🍽️',  key:'gransha grill',      lat:54.5825, lng:-5.9758 },
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

const isFreeNow = (spot) => {
  if (['free','hidden_gem'].includes(spot.badge)) return null;
  if (spot.badge === 'official') return null;
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

const getAvailability = (spot) => {
  if (!spot.available || !spot.total) return null;
  const pct = spot.available / spot.total;
  if (pct > 0.3) return { color:'#22c55e', label:'Est. available', bg:'rgba(34,197,94,0.12)' };
  if (pct > 0.1) return { color:'#f59e0b', label:'Est. filling',   bg:'rgba(245,158,11,0.12)' };
  if (pct > 0)   return { color:'#ef4444', label:'Est. busy',      bg:'rgba(239,68,68,0.12)' };
  return           { color:'#ef4444', label:'Often full',      bg:'rgba(239,68,68,0.2)' };
};

const ls = {
  get: (k, fb) => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):fb; } catch { return fb; } },
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
    setError(''); setNotice(''); setLoading(true);

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
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl my-auto">
        <div style={{ background: 'linear-gradient(135deg,#1a2332 0%,#2d4a6e 100%)' }} className="px-6 pt-8 pb-6 text-center">
          <div className="w-16 h-16 bg-[#4a9eff] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <MapPin size={30} className="text-white" strokeWidth={2.5}/>
          </div>
          <h2 className="text-white font-extrabold text-2xl tracking-tight">ParkEasy Belfast</h2>
          <p className="text-blue-300 text-sm mt-1">Find where locals actually park</p>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            {WELCOME_STATS.map(([e,n,l])=>(
              <div key={l} className="bg-gray-50 rounded-xl py-2.5">
                <p className="text-lg">{e}</p>
                <p className="font-extrabold text-gray-900 text-sm">{n}</p>
                <p className="text-gray-400 text-[10px]">{l}</p>
              </div>
            ))}
          </div>

          {isSupabaseEnabled && (
            <div className="flex bg-gray-100 rounded-xl p-1 text-sm font-bold">
              {[['signup','Sign up'],['login','Log in']].map(([m,label])=>(
                <button key={m} type="button"
                  onClick={()=>{ setMode(m); setError(''); setNotice(''); }}
                  className={`flex-1 py-2 rounded-lg transition-all ${mode===m ? 'bg-white text-[#1a2332] shadow-sm' : 'text-gray-400'}`}>
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
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] bg-gray-50"
              />
            )}
            <input
              required type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="Email address" autoComplete="email"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] bg-gray-50"
            />
            {isSupabaseEnabled && (
              <input
                required type="password" value={password} onChange={e=>setPassword(e.target.value)}
                placeholder={isSignup ? 'Create a password (min 6 characters)' : 'Password'}
                autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={6}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] bg-gray-50"
              />
            )}

            {error  && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            {notice && <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">{notice}</p>}

            <button type="submit" disabled={loading}
              className="w-full bg-[#4a9eff] text-white py-3.5 rounded-xl font-bold text-sm hover:bg-blue-500 active:scale-[0.98] transition-all shadow-md disabled:opacity-60">
              {submitLabel}
            </button>
          </form>

          {isSupabaseEnabled && !isSignup && (
            <button onClick={resetPassword} type="button"
              className="w-full text-center text-xs text-[#4a9eff] hover:underline">
              Forgot your password?
            </button>
          )}

          <button onClick={onSkip} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-1 transition-colors">
            Browse without an account
          </button>
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
    try {
      await fetch('https://formsubmit.co/ajax/martinrooney250@gmail.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: `🏪 New Business Listing: ${form.name}`,
          'Business Name': form.name,
          Address: form.address,
          Email: form.email,
          Phone: form.phone || 'Not provided',
          _honey: '',
          _captcha: 'false',
        }),
      });
    } catch { /* silent fail */ }
    setDone(true);
  };

  if (done) return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm p-8 text-center space-y-4 shadow-2xl">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <Check size={32} className="text-green-600" strokeWidth={2.5}/>
        </div>
        <h3 className="text-xl font-bold text-gray-900">Request Received!</h3>
        <p className="text-sm text-gray-500 leading-relaxed">We'll add your business to the directory and map your nearest parking spots within 24 hours.</p>
        <button onClick={onClose} className="w-full bg-[#1a2332] text-white py-3 rounded-xl font-bold hover:bg-[#243447] transition">Done</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">List Your Business Free</h2>
            <p className="text-xs text-gray-400">Customers see exactly where to park</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200 transition"><X size={16}/></button>
        </div>
        <div className="p-6">
          <form onSubmit={submit} className="space-y-3">
            <input required value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Business name *" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] bg-gray-50"/>
            <input required value={form.address} onChange={e=>set('address',e.target.value)} placeholder="Full address *" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] bg-gray-50"/>
            <input required type="email" value={form.email} onChange={e=>set('email',e.target.value)} placeholder="Contact email *" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] bg-gray-50"/>
            <input value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="Phone (optional)" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] bg-gray-50"/>
            <button type="submit" disabled={submitting} className="w-full bg-[#4a9eff] text-white py-3.5 rounded-xl font-bold text-sm hover:bg-blue-500 transition shadow-md disabled:opacity-60">
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

  if (isPremium) return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm p-8 text-center space-y-4 shadow-2xl">
        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto">
          <Star size={32} className="text-yellow-500" fill="#eab308"/>
        </div>
        <h3 className="text-xl font-bold text-gray-900">You're Premium ★</h3>
        <p className="text-sm text-gray-500 leading-relaxed">Full access to all ParkEasy Premium features. Thanks for supporting Belfast's community!</p>
        <button onClick={onClose} className="w-full bg-[#1a2332] text-white py-3 rounded-xl font-bold hover:bg-[#243447] transition">Done</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div style={{ background: 'linear-gradient(135deg,#1a2332 0%,#2d4a6e 100%)' }} className="p-6 text-center relative">
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 transition"><X size={16}/></button>
          <div className="w-14 h-14 bg-yellow-400 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
            <Star size={28} fill="currentColor" className="text-yellow-900"/>
          </div>
          <h2 className="text-white font-extrabold text-xl">ParkEasy Premium</h2>
          <p className="text-blue-300 text-sm mt-1">Support Belfast's community parking finder</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            {[
              ['🔍','See all spots — free users see top 10 only'],
              ['📍','Sort by distance — nearest spots first'],
              ['⚡','EV charging filter — find charge points'],
              ['🗺️','Offline maps — works without signal'],
              ['🔔','Notifications when spots free up'],
              ['💎','Premium badge on your profile'],
            ].map(([icon,text])=>(
              <div key={text} className="flex items-center gap-3 text-sm text-gray-700">
                <span className="w-6 text-center text-base">{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <a href={STRIPE_MONTHLY} target="_blank" rel="noreferrer"
              className="block rounded-2xl border-2 border-[#4a9eff] p-4 text-center hover:bg-blue-50 active:scale-[0.98] transition-all">
              <p className="text-[10px] text-[#4a9eff] font-bold uppercase tracking-widest mb-1">Monthly</p>
              <p className="text-3xl font-extrabold text-gray-900">£2.99</p>
              <p className="text-xs text-gray-400 mb-3">per month</p>
              <span className="block w-full bg-[#4a9eff] text-white py-2 rounded-xl text-xs font-bold">Subscribe</span>
            </a>
            <a href={STRIPE_ANNUAL} target="_blank" rel="noreferrer"
              className="block rounded-2xl border-2 border-[#1a2332] p-4 text-center hover:bg-gray-50 active:scale-[0.98] transition-all relative">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-yellow-900 text-[9px] font-black px-3 py-1 rounded-full whitespace-nowrap shadow">BEST VALUE</span>
              <p className="text-[10px] text-[#1a2332] font-bold uppercase tracking-widest mb-1 mt-1">Annual</p>
              <p className="text-3xl font-extrabold text-gray-900">£20</p>
              <p className="text-xs text-gray-400 mb-3">per year</p>
              <span className="block w-full bg-[#1a2332] text-white py-2 rounded-xl text-xs font-bold">Subscribe</span>
            </a>
          </div>
          <p className="text-center text-xs text-gray-400">Secure payment via Stripe · Cancel any time</p>

          {!showCodeBox ? (
            <button onClick={()=>setShowCodeBox(true)} className="block w-full text-center text-xs text-gray-400 underline hover:text-gray-600">
              Have a VIP code?
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input value={code} onChange={e=>{ setCode(e.target.value); setCodeError(false); }}
                  placeholder="Enter VIP code" autoFocus
                  className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#4a9eff]"/>
                <button onClick={submitCode} className="bg-[#1a2332] text-white px-4 rounded-xl text-sm font-bold hover:bg-[#243447] transition">Redeem</button>
              </div>
              {codeError && <p className="text-center text-xs text-red-500">That code isn't valid. Check it and try again.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── User Menu ─────────────────────────────────────────────────────────────────
const UserMenu = ({ user, spotsAdded, isPremium, onSignOut, onUpgrade, onClose }) => (
  <div className="fixed inset-0 z-[150]" onClick={onClose}>
    <div className="absolute top-16 right-3 bg-white rounded-2xl shadow-2xl border border-gray-100 w-64 overflow-hidden" onClick={e=>e.stopPropagation()}>
      <div style={{background:'#1a2332'}} className="p-4 flex items-center gap-3">
        <div className="w-11 h-11 bg-[#4a9eff] rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-white font-bold text-sm truncate">{user.name}</p>
          <p className="text-blue-300 text-xs truncate">{user.email}</p>
        </div>
        {isPremium && <Star size={16} className="text-yellow-400 flex-shrink-0 ml-auto" fill="#facc15"/>}
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xl font-extrabold text-gray-900">{spotsAdded}</p>
            <p className="text-[10px] text-gray-400 font-medium">Spots Added</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            {isPremium
              ? <><p className="text-yellow-500 font-extrabold text-sm">★ PREMIUM</p><p className="text-[10px] text-gray-400 font-medium">Active</p></>
              : <><p className="text-[#4a9eff] font-extrabold text-sm">FREE</p><p className="text-[10px] text-gray-400 font-medium">Upgrade →</p></>
            }
          </div>
        </div>
        {!isPremium && (
          <button onClick={onUpgrade} className="w-full bg-yellow-400 text-yellow-900 py-2.5 rounded-xl font-bold text-xs hover:bg-yellow-300 transition">
            ★ Upgrade to Premium — £2.99/mo
          </button>
        )}
        <div className="border-t border-gray-100 pt-2">
          <button onClick={onSignOut} className="w-full flex items-center gap-2 text-sm text-red-500 hover:text-red-600 font-medium py-1 transition-colors">
            <LogOut size={15}/> Sign out
          </button>
        </div>
      </div>
    </div>
  </div>
);

// ── SpotCard ──────────────────────────────────────────────────────────────────
const SpotCard = ({ spot, saved, onSave, rating, onRate, voted, onVote, onBook, onViewMap }) => {
  const [shareDone, setShareDone] = useState(false);
  const [imgErr,    setImgErr]    = useState(false);
  const isOfficial = ['NCP Belfast','Q-Park Belfast','Belfast City Council','Official'].includes(spot.by);
  const freeNow = isFreeNow(spot);
  const avail = getAvailability(spot);
  const kerb = KERB[spot.badge] || KERB.free;

  const svUrl = !spot.photo && !imgErr ? spotImageUrl(spot.lat, spot.lng) : null;
  const photoSrc = spot.photo || svUrl;

  const handleShare = async () => {
    const text = `${spot.name} — ${spot.notes.slice(0,100)}`;
    const url = 'https://parkeasy.uk/';
    if (navigator.share) {
      try { await navigator.share({ title:'ParkEasy Belfast', text, url }); } catch {}
    } else {
      navigator.clipboard?.writeText(`${spot.name}\n${text}\n${url}`);
      setShareDone(true);
      setTimeout(()=>setShareDone(false), 2200);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
      style={{borderLeft: `${kerb.width}px ${kerb.style} ${kerb.color}`}}>
      <div
        className="relative h-40 overflow-hidden flex items-center justify-center"
        style={{ background: photoSrc ? undefined : 'linear-gradient(135deg,#1a2332 0%,#243447 100%)' }}
      >
        {photoSrc
          ? <img src={photoSrc} alt={spot.name} className="w-full h-full object-cover" onError={()=>setImgErr(true)}/>
          : <div className="flex flex-col items-center gap-2 opacity-20"><Car size={40} className="text-white"/></div>}

        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent pointer-events-none"/>

        <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
          <Badge type={spot.badge}/>
          {freeNow === true && (
            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-green-500 text-white animate-pulse shadow">
              Free now ✓
            </span>
          )}
        </div>

        <button
          onClick={()=>onSave(spot.id)}
          className={`absolute top-2.5 right-2.5 w-9 h-9 rounded-full shadow-md flex items-center justify-center transition-all active:scale-90 ${
            saved ? 'bg-[#4a9eff]' : 'bg-white/90 backdrop-blur-sm'
          }`}>
          <Bookmark size={15} className={saved?'text-white':'text-gray-500'} fill={saved?'white':'none'}/>
        </button>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-bold text-gray-900 text-sm leading-snug flex-1">{spot.name}</h3>
          <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0 bg-gray-50 px-2 py-0.5 rounded-full">{spot.walk}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="flex items-center gap-1 text-xs text-gray-500"><Clock size={11}/>{spot.restriction}</span>
          {avail && (
            <span style={{background:avail.bg,color:avail.color}}
              className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:avail.color}}/>
              {avail.label}
            </span>
          )}
          {spot.spaces != null && !avail && (
            <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
              <Car size={10}/>{spot.spaces} spaces
            </span>
          )}
          {spot.price && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {spot.price}
            </span>
          )}
          {spot.ev?.available && (
            <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
              <Zap size={9}/>EV {spot.ev.ports} × {spot.ev.speed}
            </span>
          )}
        </div>

        <div className="border-l-[3px] border-[#4a9eff] pl-3 mb-3 bg-blue-50/50 py-2 rounded-r-lg">
          <p className="text-xs text-gray-600 italic leading-relaxed line-clamp-2">{spot.notes}</p>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <a href={directionsUrl(spot.lat,spot.lng)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-xs bg-[#1a2332] text-white px-3 py-2 rounded-full font-semibold hover:bg-[#243447] active:scale-95 transition-all">
            <Navigation size={11}/>Directions
          </a>
          {onBook && (
            <button onClick={()=>onBook(spot)}
              className="flex items-center gap-1.5 text-xs bg-green-600 text-white px-3 py-2 rounded-full font-semibold hover:bg-green-700 active:scale-95 transition-all">
              <Receipt size={11}/>Book
            </button>
          )}
          <button onClick={handleShare}
            className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-full font-semibold border transition-all active:scale-95 ${
              shareDone ? 'bg-green-50 border-green-300 text-green-700' : 'border-gray-200 text-gray-600 hover:border-[#4a9eff] hover:text-[#4a9eff]'
            }`}>
            {shareDone ? <><Check size={11}/>Copied!</> : <><Share2 size={11}/>Share</>}
          </button>
          {onViewMap && (
            <button onClick={()=>onViewMap(spot)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-full font-semibold border border-gray-200 text-gray-600 hover:border-[#4a9eff] hover:text-[#4a9eff] active:scale-95 transition-all">
              <Map size={11}/>Map
            </button>
          )}
          <div className="ml-auto text-xs text-gray-400">
            {isOfficial
              ? <span className="font-semibold text-blue-700">{spot.by}</span>
              : (
                <button onClick={() => onVote?.(spot.id)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all active:scale-90 ${voted ? 'bg-amber-50 text-amber-600' : 'text-gray-500 hover:text-amber-500'}`}>
                  <Star size={11} fill={voted ? '#fbbf24' : 'none'} className={voted ? 'text-amber-400' : 'text-gray-300'}/>
                  <span className="font-medium">{spot.votes + (voted ? 1 : 0)}</span>
                </button>
              )}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2.5 border-t border-gray-100">
          <span className="text-[11px] text-gray-400 flex-1">Still accurate?</span>
          <button onClick={()=>onRate(spot.id,'accurate')}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
              rating==='accurate' ? 'bg-green-50 border-green-400 text-green-700 font-bold' : 'border-gray-200 text-gray-500 hover:border-green-300'
            }`}>✓ Yes</button>
          <button onClick={()=>onRate(spot.id,'changed')}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
              rating==='changed' ? 'bg-amber-50 border-amber-400 text-amber-700 font-bold' : 'border-gray-200 text-gray-500 hover:border-amber-300'
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

const ParkingMap = ({ spots, center, zoom=13, height=220 }) => (
  <div style={{height}} className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
    <MapContainer center={center || BELFAST_CENTER} zoom={zoom}
      style={{width:'100%',height:'100%'}} scrollWheelZoom={false} zoomControl={true}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'/>
      {center && <RecenterMap center={center} zoom={zoom}/>}
      {spots.map(s=>(
        <Marker key={s.id} position={[s.lat,s.lng]} icon={PIN[s.badge]||PIN.free}>
          <Popup>
            <div style={{minWidth:160}}>
              <p className="font-bold text-sm mb-1">{s.name}</p>
              <Badge type={s.badge} sm/>
              {s.price && <p className="text-xs mt-1.5 font-semibold text-gray-700">{s.price}</p>}
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{s.notes.slice(0,80)}…</p>
              <a href={directionsUrl(s.lat,s.lng)} target="_blank" rel="noreferrer"
                className="mt-2 block text-center text-xs bg-[#4a9eff] text-white px-3 py-1.5 rounded-lg font-semibold">
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
const BADGE_FILTERS = [
  { id:'all',       label:'All',       color:'#374151', bg:'#f3f4f6' },
  { id:'free',      label:'🟢 Free',   color:'#15803d', bg:'#dcfce7' },
  { id:'hidden_gem',label:'💎 Hidden', color:'#7e22ce', bg:'#f3e8ff' },
  { id:'official',  label:'🅿 Official',color:'#1e3a5f', bg:'#dbeafe' },
  { id:'timed',     label:'⏱ Timed',   color:'#9a3412', bg:'#fff7ed' },
];

const SORT_OPTIONS_FREE    = [
  { id:'popular', label:'Most Popular' },
  { id:'free',    label:'Free First' },
  { id:'alpha',   label:'A–Z' },
];
const SORT_OPTIONS_PREMIUM = [
  { id:'popular',  label:'Most Popular' },
  { id:'free',     label:'Free First' },
  { id:'distance', label:'📍 Nearest' },
  { id:'alpha',    label:'A–Z' },
];

const FREE_RESULTS_LIMIT = 10;

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

// Returns a street-level image URL for a parking spot.
// Prefers Google Street View when an API key is configured.
// Falls back to a free OpenStreetMap static map tile — no key needed.
const spotImageUrl = (lat, lng) =>
  GOOGLE_MAPS_KEY
    ? `https://maps.googleapis.com/maps/api/streetview?size=600x300&location=${lat},${lng}&fov=90&pitch=0&key=${GOOGLE_MAPS_KEY}`
    : `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=17&size=600x300&maptype=mapnik&markers=${lat},${lng},red-pushpin`;

const SearchTab = ({ saved, onSave, ratings, onRate, votes, onVote, onBook, isPremium, onUpgrade, citySpots, cityCenter, cityName }) => {
  const [query,       setQuery]       = useState('');
  const [badgeFilter, setBadgeFilter] = useState('all');
  const [sortBy,      setSortBy]      = useState('popular');
  const [showMap,     setShowMap]     = useState(true);
  const [showSort,    setShowSort]    = useState(false);
  const [evOnly,      setEvOnly]      = useState(false);
  const [userLoc,     setUserLoc]     = useState(null);
  const [focusSpot,   setFocusSpot]   = useState(null);
  const inputRef = useRef(null);
  const mapRef = useRef(null);

  const SORT_OPTIONS = isPremium ? SORT_OPTIONS_PREMIUM : SORT_OPTIONS_FREE;

  // Reset map focus when switching city or search criteria
  useEffect(() => { setFocusSpot(null); }, [cityCenter, query, badgeFilter, evOnly]);

  const viewOnMap = (spot) => {
    setFocusSpot(spot);
    setShowMap(true);
    setTimeout(() => mapRef.current?.scrollIntoView({behavior:'smooth', block:'center'}), 50);
  };

  // Grab location when distance sort is chosen
  useEffect(() => {
    if (sortBy === 'distance' && !userLoc) {
      navigator.geolocation?.getCurrentPosition(
        ({coords:{latitude:lat,longitude:lng}}) => setUserLoc([lat,lng]),
        () => setSortBy('popular')
      );
    }
  }, [sortBy]);

  const filtered = useMemo(() => {
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

    if (badgeFilter !== 'all') {
      spots = spots.filter(s => s.badge === badgeFilter);
    }

    if (evOnly) {
      spots = spots.filter(s => s.ev?.available);
    }

    return [...spots].sort((a, b) => {
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
  }, [citySpots, query, badgeFilter, sortBy, evOnly, userLoc]);

  const visibleSpots = isPremium ? filtered : filtered.slice(0, FREE_RESULTS_LIMIT);
  const hiddenCount  = isPremium ? 0 : Math.max(0, filtered.length - FREE_RESULTS_LIMIT);

  const isSearching = query.trim().length > 0 || badgeFilter !== 'all' || evOnly;
  const mapCenter = focusSpot ? [focusSpot.lat, focusSpot.lng] : visibleSpots.length ? [visibleSpots[0].lat, visibleSpots[0].lng] : cityCenter;
  const mapZoom = focusSpot ? 16 : isSearching ? 13 : 12;

  const doSearch = (q) => {
    setQuery(q);
    inputRef.current?.blur();
  };

  const freeCount = citySpots.filter(s => ['free','hidden_gem'].includes(s.badge)).length;

  return (
    <div className="p-4 space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
        <input
          ref={inputRef}
          value={query}
          onChange={e=>setQuery(e.target.value)}
          onKeyDown={e=>{ if(e.key==='Enter') doSearch(query); }}
          placeholder={citySpots.length ? `Search ${citySpots.length} ${cityName} parking spots…` : `Search ${cityName} parking spots…`}
          className="w-full pl-10 pr-10 py-3.5 rounded-xl border border-gray-200 bg-white shadow-sm text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a9eff] transition"
        />
        {query && (
          <button onClick={()=>setQuery('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-300 transition">
            <X size={12}/>
          </button>
        )}
      </div>

      {/* Badge filter row */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {BADGE_FILTERS.map(f => (
          <button key={f.id} onClick={()=>setBadgeFilter(f.id)}
            style={badgeFilter===f.id ? {background:f.bg, color:f.color} : {}}
            className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap font-semibold flex-shrink-0 transition-all active:scale-95 ${
              badgeFilter===f.id ? 'border-current shadow-sm' : 'border-gray-200 text-gray-500 bg-white hover:border-gray-300'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Results header + controls */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-gray-900">
            {filtered.length} {isSearching ? 'matching' : ''} spot{filtered.length!==1?'s':''}
            {isSearching && query && <span className="text-[#4a9eff] font-normal"> for "{query}"</span>}
          </p>
          {!isSearching && <p className="text-xs text-gray-400">{freeCount} free or hidden gem spots</p>}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <button onClick={()=>setShowSort(v=>!v)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-gray-200 bg-white text-gray-600 font-semibold hover:border-gray-300 transition">
              <Filter size={11}/>{SORT_OPTIONS.find(s=>s.id===sortBy)?.label}
            </button>
            {showSort && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden w-36">
                {SORT_OPTIONS.map(o=>(
                  <button key={o.id} onClick={()=>{setSortBy(o.id);setShowSort(false);}}
                    className={`w-full text-left px-3 py-2.5 text-xs font-medium transition-colors hover:bg-gray-50 ${sortBy===o.id?'text-[#4a9eff] font-bold':'text-gray-700'}`}>
                    {sortBy===o.id && '✓ '}{o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={()=>setShowMap(m=>!m)}
            className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border font-semibold transition-all ${
              showMap ? 'bg-[#1a2332] text-white border-[#1a2332]' : 'bg-white text-gray-600 border-gray-200'
            }`}>
            <Map size={11}/>{showMap?'Map':'Map'}
          </button>
        </div>
      </div>

      {/* EV filter toggle (premium) */}
      {isPremium && (
        <button onClick={()=>setEvOnly(v=>!v)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-semibold transition-all ${
            evOnly ? 'bg-yellow-400 text-yellow-900 border-yellow-400' : 'bg-white text-gray-600 border-gray-200 hover:border-yellow-400'
          }`}>
          <Zap size={11}/> EV charging only
        </button>
      )}

      {/* Map */}
      {showMap && (
        <div ref={mapRef}>
          <ParkingMap spots={visibleSpots} center={mapCenter} zoom={mapZoom} height={isSearching ? 200 : 260}/>
        </div>
      )}

      {/* Keyword chips (when not searching) */}
      {!isSearching && (
        <div>
          <p className="text-[11px] text-gray-400 uppercase tracking-widest font-bold mb-2">Quick search</p>
          <div className="flex flex-wrap gap-2">
            {SEARCH_KEYWORDS.map(a=>(
              <button key={a} onClick={()=>doSearch(a)}
                className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full hover:border-[#4a9eff] hover:text-[#4a9eff] transition-all shadow-sm">
                {a}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Spot list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Search size={24} className="text-gray-300"/>
          </div>
          {citySpots.length === 0 ? (
            <>
              <p className="font-bold text-gray-700">No spots in {cityName} yet</p>
              <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto leading-relaxed">Be the first to share a great parking spot in {cityName} — tap "Add Spot" below.</p>
            </>
          ) : (
            <>
              <p className="font-bold text-gray-700">No spots found</p>
              <p className="text-sm text-gray-400 mt-1">Try searching "City Centre" or "Cathedral Quarter"</p>
              <button onClick={()=>{setQuery('');setBadgeFilter('all');setEvOnly(false);}} className="mt-3 text-xs text-[#4a9eff] font-semibold underline">Clear filters</button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleSpots.map(s=>(
            <SpotCard key={s.id} spot={s} saved={saved.has(s.id)} onSave={onSave} rating={ratings[s.id]} onRate={onRate} voted={!!votes?.[s.id]} onVote={onVote} onBook={onBook} onViewMap={viewOnMap}/>
          ))}
          {hiddenCount > 0 && (
            <div onClick={onUpgrade}
              className="rounded-2xl border-2 border-dashed border-yellow-300 bg-yellow-50 p-5 text-center cursor-pointer hover:bg-yellow-100 transition-colors">
              <p className="text-2xl mb-1">🔒</p>
              <p className="font-bold text-gray-900 text-sm">{hiddenCount} more spot{hiddenCount!==1?'s':''} available</p>
              <p className="text-xs text-gray-500 mt-0.5 mb-3">Upgrade to Premium to see all {filtered.length} results, sort by distance, and more</p>
              <span className="inline-block bg-yellow-400 text-yellow-900 text-xs font-bold px-4 py-2 rounded-full shadow">★ Unlock Premium</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── NearbyTab ─────────────────────────────────────────────────────────────────
const NearbyTab = ({ saved, onSave, ratings, onRate, votes, onVote, onBook, cityName, onCityDetected, userSpots = [] }) => {
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
    onCityDetected?.(sourceCity.id);
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
    navigator.geolocation.getCurrentPosition(
      ({coords:{latitude:lat,longitude:lng}}) => { setLoc([lat,lng]); buildNearby(lat,lng); },
      () => { const lat=54.5973,lng=-5.9301; setLoc([lat,lng]); buildNearby(lat,lng); setErr('Location access denied — showing spots from Belfast city centre.'); }
    );
  };

  const viewOnMap = (spot) => {
    setFocusSpot(spot);
    setTimeout(() => mapRef.current?.scrollIntoView({behavior:'smooth', block:'center'}), 50);
  };

  if (!loc) return (
    <div className="p-8 flex flex-col items-center text-center space-y-5">
      <div className="w-24 h-24 bg-gradient-to-br from-[#eef5ff] to-[#dbeafe] rounded-full flex items-center justify-center shadow-inner">
        <Crosshair size={42} className="text-[#4a9eff]"/>
      </div>
      <div>
        <h3 className="text-xl font-bold text-gray-900">Parking Near You</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-xs leading-relaxed">
          See the closest community-verified spots to your current location — we'll find your town automatically.
        </p>
      </div>
      <button onClick={findNearby} disabled={loading}
        className="flex items-center gap-2 bg-[#4a9eff] text-white px-8 py-3.5 rounded-xl font-semibold hover:bg-blue-500 active:scale-95 transition-all disabled:opacity-60 shadow-md">
        {loading ? '⏳ Locating…' : <><Crosshair size={18}/>Use My Location</>}
      </button>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {err && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3.5 py-3 rounded-xl">
          <Info size={14} className="mt-0.5 flex-shrink-0"/><span>{err}</span>
        </div>
      )}
      {fallback && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-800 text-xs px-3.5 py-3 rounded-xl">
          <Info size={14} className="mt-0.5 flex-shrink-0"/>
          <span>No community spots in <strong>{fallback}</strong> yet — showing the closest spots in Belfast. Know a good spot near you? Add it from the "Add Spot" tab and be the first!</span>
        </div>
      )}
      <div ref={mapRef}>
        <ParkingMap spots={nearby} center={focusSpot ? [focusSpot.lat,focusSpot.lng] : loc} zoom={focusSpot ? 16 : 13} height={240}/>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">{nearby.length ? `${nearby.length} closest spots in ${cityName}` : `No spots near you yet`}</p>
        <button onClick={()=>{setLoc(null);setNearby([]);setErr('');setFocusSpot(null);setFallback(null);}} className="text-xs text-[#4a9eff] font-semibold">Refresh</button>
      </div>
      {nearby.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-gray-400 max-w-xs mx-auto leading-relaxed">No community spots in {cityName} yet — be the first to add one from the "Add Spot" tab!</p>
        </div>
      )}
      <div className="space-y-4">
        {nearby.map(s=>(
          <SpotCard key={s.id} spot={{...s, dist:Math.round(s.realDist*10)/10}}
            saved={saved.has(s.id)} onSave={onSave} rating={ratings[s.id]} onRate={onRate} voted={!!votes?.[s.id]} onVote={onVote} onBook={onBook} onViewMap={viewOnMap}/>
        ))}
      </div>
    </div>
  );
};

// ── BusinessesTab ─────────────────────────────────────────────────────────────
const BusinessesTab = ({ onGetListed }) => {
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
      <div className="bg-gradient-to-r from-[#1a2332] to-[#2d4a6e] text-white p-4 rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold">Own a business in Belfast?</p>
            <p className="text-xs text-blue-200 mt-0.5 leading-relaxed">Get listed free — customers see exactly where to park when they search for you.</p>
          </div>
          <button onClick={onGetListed}
            className="flex-shrink-0 text-xs bg-[#4a9eff] text-white px-3 py-2 rounded-full font-semibold hover:bg-blue-400 active:scale-95 transition-all whitespace-nowrap">
            Get Listed →
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
        <input
          value={bizSearch} onChange={e=>setBizSearch(e.target.value)}
          placeholder="Search businesses…"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a9eff] transition"
        />
      </div>

      <p className="text-[11px] text-gray-400 uppercase tracking-widest font-bold">{filtered.length} businesses · Belfast</p>

      {filtered.map(b => {
        const spots = SPOTS.filter(s => s.tags.some(t => t.includes(b.key)));
        const isOpen = open === b.id;
        return (
          <div key={b.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button onClick={()=>setOpen(isOpen ? null : b.id)}
              className="w-full p-4 flex items-center gap-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors">
              <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                {b.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-sm">{b.name}</p>
                <p className="text-xs text-gray-400 truncate">{b.addr}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">{b.cat}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">{spots.length} parking spots</span>
                </div>
              </div>
              <ChevronRight size={16} className={`text-gray-300 transition-transform duration-200 flex-shrink-0 ${isOpen?'rotate-90':''}`}/>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100">
                {spots.length > 0 && (
                  <div className="px-3 pt-3">
                    <ParkingMap spots={spots} center={[b.lat, b.lng]} zoom={15} height={180}/>
                  </div>
                )}
                <div className="p-3 space-y-2">
                  {spots.length === 0
                    ? <p className="text-sm text-gray-400 text-center py-6">No spots yet — be the first to add one!</p>
                    : spots.map(s => (
                      <div key={s.id} className="flex gap-3 p-3 bg-gray-50 rounded-xl">
                        {s.photo && <img src={s.photo} alt={s.name} className="w-16 h-16 object-cover rounded-lg flex-shrink-0"/>}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="font-semibold text-xs text-gray-900 flex-1">{s.name}</span>
                            <Badge type={s.badge} sm/>
                          </div>
                          <p className="text-xs text-gray-500 line-clamp-2 italic leading-relaxed">{s.notes}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[10px] text-gray-400">{s.walk} · {s.restriction}</span>
                            <a href={directionsUrl(s.lat,s.lng)} target="_blank" rel="noreferrer"
                              className="text-[10px] text-[#4a9eff] font-bold">Directions →</a>
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
const SavedTab = ({ saved, onSave, ratings, onRate, votes, onVote, onBook, allSpots = SPOTS }) => {
  const spots = allSpots.filter(s => saved.has(s.id));
  const [focusSpot, setFocusSpot] = useState(null);
  const mapRef = useRef(null);

  const viewOnMap = (spot) => {
    setFocusSpot(spot);
    setTimeout(() => mapRef.current?.scrollIntoView({behavior:'smooth', block:'center'}), 50);
  };

  if (!spots.length) return (
    <div className="p-8 flex flex-col items-center text-center space-y-4">
      <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center">
        <Bookmark size={38} className="text-gray-300"/>
      </div>
      <div>
        <h3 className="text-xl font-bold text-gray-900">No saved spots</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-xs leading-relaxed">
          Tap the bookmark icon on any parking spot to save it here for quick access.
        </p>
      </div>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">{spots.length} saved spot{spots.length!==1?'s':''}</p>
        <span className="text-xs text-gray-400">Tap bookmark to remove</span>
      </div>
      {(spots.length > 1 || focusSpot) && (
        <div ref={mapRef}>
          <ParkingMap spots={spots} center={focusSpot ? [focusSpot.lat,focusSpot.lng] : [spots[0].lat, spots[0].lng]} zoom={focusSpot ? 16 : 12} height={200}/>
        </div>
      )}
      <div className="space-y-4">
        {spots.map(s=>(
          <SpotCard key={s.id} spot={s} saved={true} onSave={onSave} rating={ratings[s.id]} onRate={onRate} voted={!!votes?.[s.id]} onVote={onVote} onBook={onBook} onViewMap={viewOnMap}/>
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
      photo: null,
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
    try {
      await fetch('https://formsubmit.co/ajax/martinrooney250@gmail.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: `🅿 New Spot from ${user.name}: near ${form.near}`,
          'Submitted by': user.name,
          'User email': user.email,
          'Near': form.near,
          'Street / Area': form.street,
          'Spot type': form.type,
          'Restrictions': form.restriction,
          'Notes': form.notes || 'None',
          'Coordinates': coords ? `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}` : 'Not captured',
          _honey: '',
          _captcha: 'false',
        }),
      });
    } catch { /* silent fail */ }
    setDone(true);
    onSpotAdded(newSpot);
  };

  if (!user) return (
    <div className="p-8 flex flex-col items-center text-center space-y-5">
      <div className="w-24 h-24 bg-gradient-to-br from-[#eef5ff] to-[#dbeafe] rounded-full flex items-center justify-center shadow-inner">
        <User size={42} className="text-[#4a9eff]"/>
      </div>
      <div>
        <h3 className="text-xl font-bold text-gray-900">Join to Add a Spot</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-xs leading-relaxed">
          Sign up free to contribute spots. Earn 1 month of Premium for every verified spot you add.
        </p>
      </div>
      <button onClick={onJoinPrompt}
        className="flex items-center gap-2 bg-[#4a9eff] text-white px-8 py-3.5 rounded-xl font-semibold hover:bg-blue-500 active:scale-95 transition-all shadow-md">
        Join Free — 30 seconds →
      </button>
    </div>
  );

  if (done) return (
    <div className="p-8 flex flex-col items-center text-center space-y-5">
      <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center">
        <Check size={42} className="text-green-600" strokeWidth={2.5}/>
      </div>
      <div>
        <h3 className="text-2xl font-bold text-gray-900">Spot Submitted!</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-xs leading-relaxed">
          {coords
            ? "It's already on your map — and it'll be added for everyone after a quick community review. Thanks for helping Belfast drivers!"
            : 'Your spot will appear after a quick community review. Thanks for helping Belfast drivers!'}
        </p>
      </div>
      <div className="w-full bg-gradient-to-r from-[#1a2332] to-[#243447] text-white px-6 py-4 rounded-2xl text-center space-y-1">
        <p className="font-bold text-base">🏆 1 month Premium on the way!</p>
        <p className="text-blue-300 text-xs leading-relaxed">We'll review your spot within 24 hours. Once approved we'll email you a link to activate your free Premium month.</p>
      </div>
      <button onClick={()=>{setDone(false);setForm({near:'',street:'',type:'',restriction:'',notes:''});setPreview(null);setCoords(null);setLocErr('');}}
        className="text-[#4a9eff] text-sm font-bold underline">Submit another spot</button>
    </div>
  );

  return (
    <div className="p-4 space-y-5">
      <div className="bg-gradient-to-r from-[#1a2332] to-[#2d4a6e] text-white p-5 rounded-2xl shadow-md">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-yellow-400 rounded-xl flex items-center justify-center flex-shrink-0 shadow">
            <Star size={20} fill="currentColor" className="text-yellow-900"/>
          </div>
          <div>
            <p className="font-extrabold text-base leading-tight">Add a spot → get 1 month Premium FREE</p>
            <p className="text-blue-300 text-xs mt-0.5">Activated after we review your spot (within 24hrs)</p>
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
          <label className="block text-sm font-bold text-gray-800 mb-2">Photo (optional)</label>
          <button type="button" onClick={()=>fileRef.current.click()}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl p-5 flex flex-col items-center gap-2 text-gray-400 hover:border-[#4a9eff] hover:text-[#4a9eff] active:scale-[0.98] transition-all">
            {preview
              ? <img src={preview} alt="preview" className="w-full h-32 object-cover rounded-xl"/>
              : <><Camera size={28}/><span className="text-sm font-medium">Tap to upload a photo</span><span className="text-xs text-gray-300">JPG, PNG, HEIC</span></>}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e=>{const f=e.target.files[0];if(f)setPreview(URL.createObjectURL(f));}}/>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">Pin the location</label>
          <button type="button" onClick={captureLocation} disabled={locating}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-60 ${
              coords ? 'border-green-400 bg-green-50 text-green-700' : 'border-[#4a9eff] bg-[#eef5ff] text-[#4a9eff] hover:bg-blue-50'
            }`}>
            {locating
              ? '⏳ Getting your location…'
              : coords
                ? <><Check size={16}/>Location captured — your spot shows on the map</>
                : <><Crosshair size={16}/>Use my current location</>}
          </button>
          {locErr
            ? <p className="text-xs text-amber-600 mt-1.5">{locErr}</p>
            : !coords && <p className="text-xs text-gray-400 mt-1.5">Stand at the spot and tap this so other drivers can find it on the map. Optional — you can submit without it.</p>}
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">What's near this spot? *</label>
          <input required value={form.near} onChange={e=>set('near',e.target.value)}
            placeholder="e.g. Victoria Square, Cathedral Quarter, Titanic Belfast"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] bg-gray-50"/>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">Street or area *</label>
          <input required value={form.street} onChange={e=>set('street',e.target.value)}
            placeholder="e.g. Ann Street, beside Victoria Square"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] bg-gray-50"/>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">Spot type *</label>
          <div className="flex flex-wrap gap-2">
            {SPOT_TYPES.map(t=>(
              <button type="button" key={t} onClick={()=>set('type',t)}
                className={`text-xs px-3 py-2 rounded-full border-2 font-medium transition-all active:scale-95 ${
                  form.type===t ? 'border-[#4a9eff] bg-[#eef5ff] text-[#4a9eff]' : 'border-gray-200 text-gray-600 bg-white hover:border-gray-300'
                }`}>{t}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">Restrictions *</label>
          <div className="flex flex-wrap gap-2">
            {RESTRICTIONS.map(r=>(
              <button type="button" key={r} onClick={()=>set('restriction',r)}
                className={`text-xs px-3 py-2 rounded-full border-2 font-medium transition-all active:scale-95 ${
                  form.restriction===r ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 bg-white hover:border-gray-300'
                }`}>{r}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">Local knowledge (optional)</label>
          <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={3}
            placeholder="What should other drivers know? Restrictions, best times, how many cars fit…"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4a9eff] bg-gray-50 resize-none"/>
        </div>

        {(!form.type || !form.restriction) && (
          <p className="text-xs text-center text-amber-600 font-medium">Please select a spot type and restriction above</p>
        )}
        <button type="submit" disabled={submitting || !form.type || !form.restriction}
          className="w-full bg-[#1a2332] text-white py-4 rounded-xl font-bold text-base hover:bg-[#243447] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50">
          {submitting ? '⏳ Submitting…' : <><Plus size={20}/>Submit Parking Spot</>}
        </button>
      </form>
    </div>
  );
};

// ── iOS Install Guide Modal ───────────────────────────────────────────────────
const IOSGuide = ({ onClose }) => (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-end justify-center p-4">
    <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl pb-2">
      <div style={{background:'linear-gradient(135deg,#1a2332 0%,#2d4a6e 100%)'}} className="px-6 pt-7 pb-5 text-center">
        <div className="w-14 h-14 bg-[#4a9eff] rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
          <Smartphone size={26} className="text-white"/>
        </div>
        <h2 className="text-white font-extrabold text-xl">Add to Home Screen</h2>
        <p className="text-blue-300 text-sm mt-1">Install ParkEasy on your iPhone</p>
      </div>
      <div className="p-6 space-y-4">
        {[
          ['1', '⬆️', 'Tap the Share button', 'The box with an arrow at the bottom of Safari'],
          ['2', '📲', 'Tap "Add to Home Screen"', 'Scroll down in the share sheet to find it'],
          ['3', '✅', 'Tap "Add"', 'ParkEasy appears on your home screen like any app'],
        ].map(([n, emoji, title, desc]) => (
          <div key={n} className="flex items-start gap-3">
            <div className="w-7 h-7 bg-[#4a9eff] rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0 mt-0.5">{n}</div>
            <div>
              <p className="font-bold text-gray-900 text-sm">{emoji} {title}</p>
              <p className="text-gray-400 text-xs leading-relaxed">{desc}</p>
            </div>
          </div>
        ))}
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 text-center">
          <p className="text-xs text-blue-700 font-medium">Works offline · No App Store needed · Free forever</p>
        </div>
        <button onClick={onClose} className="w-full bg-[#1a2332] text-white py-3 rounded-xl font-bold hover:bg-[#243447] transition">Got it</button>
      </div>
    </div>
  </div>
);

// ── Booking Modal ─────────────────────────────────────────────────────────────
const DURATIONS = [1, 2, 3, 4];
const BookingModal = ({ spot, onClose, onConfirm }) => {
  const [hours, setHours] = useState(2);
  if (!spot) return null;
  const total = spot.pricing?.free ? 'FREE' : spot.price
    ? `£${(parseFloat(spot.price.replace(/[^0-9.]/g, '')) * hours).toFixed(2)}`
    : (spot.badge === 'free' || spot.badge === 'hidden_gem') ? 'FREE' : null;
  const ref = `PE-${Date.now().toString().slice(-6)}`;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div style={{background:'#1a2332'}} className="px-6 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-base leading-snug">{spot.name}</h2>
            <p className="text-blue-300 text-xs mt-0.5">Booking ref: {ref}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30">
            <X size={16}/>
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <p className="text-sm font-bold text-gray-800 mb-2">Duration</p>
            <div className="flex gap-2">
              {DURATIONS.map(h => (
                <button key={h} onClick={()=>setHours(h)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${
                    hours===h ? 'border-[#4a9eff] bg-[#eef5ff] text-[#4a9eff]' : 'border-gray-200 text-gray-600 bg-white hover:border-gray-300'
                  }`}>{h}h</button>
              ))}
            </div>
          </div>
          <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Location</span><span className="font-semibold text-gray-800 text-right max-w-[55%] truncate">{spot.name}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Duration</span><span className="font-semibold text-gray-800">{hours} hour{hours>1?'s':''}</span></div>
            <div className="flex justify-between text-sm border-t border-gray-200 pt-2 mt-2">
              <span className="font-bold text-gray-800">Total</span>
              <span className={`font-extrabold text-base ${total==='FREE'?'text-green-600':'text-gray-900'}`}>{total||'See on site'}</span>
            </div>
          </div>
          <button onClick={()=>onConfirm({spot,hours,total,ref,date:new Date()})}
            className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold text-sm hover:bg-green-700 active:scale-[0.98] transition-all shadow-md">
            Confirm Booking →
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Booking History tab ───────────────────────────────────────────────────────
const BookingHistoryTab = ({ bookings }) => {
  if (!bookings.length) return (
    <div className="p-8 flex flex-col items-center text-center space-y-4">
      <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center"><Receipt size={32} className="text-gray-300"/></div>
      <h3 className="text-xl font-bold text-gray-900">No bookings yet</h3>
      <p className="text-sm text-gray-500 max-w-xs leading-relaxed">Book a parking spot and your receipt will appear here.</p>
    </div>
  );
  return (
    <div className="p-4 space-y-3">
      <p className="text-sm font-bold text-gray-900">{bookings.length} booking{bookings.length!==1?'s':''}</p>
      {bookings.map(b=>(
        <div key={b.ref} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="font-bold text-gray-900 text-sm leading-snug">{b.spot.name}</p>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap">Confirmed</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>Ref: <span className="font-semibold text-gray-700">{b.ref}</span></span>
            <span>Duration: <span className="font-semibold text-gray-700">{b.hours}h</span></span>
            <span>Date: <span className="font-semibold text-gray-700">{new Date(b.date).toLocaleDateString('en-GB')}</span></span>
            <span>Total: <span className={`font-bold ${b.total==='FREE'?'text-green-600':'text-gray-900'}`}>{b.total||'—'}</span></span>
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Install Banner ────────────────────────────────────────────────────────────
const InstallBanner = ({ onInstall, onDismiss, isIOS }) => (
  <div className="mx-3 mt-3 bg-gradient-to-r from-[#1a2332] to-[#2d4a6e] text-white px-4 py-3 rounded-2xl flex items-center gap-3 shadow-lg">
    <div className="w-10 h-10 bg-[#4a9eff] rounded-xl flex items-center justify-center flex-shrink-0 shadow">
      <Download size={18} className="text-white"/>
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-bold text-sm leading-tight">Install ParkEasy</p>
      <p className="text-blue-300 text-xs leading-tight mt-0.5">
        {isIOS ? 'Tap Share → Add to Home Screen' : 'Add to your home screen — works offline'}
      </p>
    </div>
    <button onClick={onInstall}
      className="flex-shrink-0 bg-[#4a9eff] text-white text-xs px-3 py-1.5 rounded-full font-bold hover:bg-blue-400 active:scale-95 transition-all whitespace-nowrap">
      {isIOS ? 'How?' : 'Install'}
    </button>
    <button onClick={onDismiss} className="flex-shrink-0 w-6 h-6 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition">
      <X size={11}/>
    </button>
  </div>
);

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id:'search',     label:'Search',     Icon:Search    },
  { id:'nearby',     label:'Nearby',     Icon:Crosshair },
  { id:'businesses', label:'Local',      Icon:Building2 },
  { id:'bookings',   label:'Bookings',   Icon:Receipt   },
  { id:'add',        label:'Add Spot',   Icon:Plus      },
];

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,           setTab]           = useState('search');
  const [user,          setUser]          = useState(()=>ls.get('pe_user', null));
  const [saved,         setSaved]         = useState(()=>new Set(ls.get('pe_saved', [])));
  const [ratings,       setRatings]       = useState(()=>ls.get('pe_ratings', {}));
  const [showWelcome,   setShowWelcome]   = useState(()=>!ls.get('pe_user',null) && !ls.get('pe_skipped',false));
  const [showUserMenu,  setShowUserMenu]  = useState(false);
  const [showBizModal,  setShowBizModal]  = useState(false);
  const [isPremium,     setIsPremium]     = useState(()=>ls.get('pe_premium', false));
  const [showPricing,   setShowPricing]   = useState(false);
  const [votes,          setVotes]          = useState(()=>ls.get('pe_votes', {}));
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstall,    setShowInstall]    = useState(false);
  const [showIOSGuide,   setShowIOSGuide]   = useState(false);
  const [bookings,       setBookings]       = useState(()=>ls.get('pe_bookings', []));
  const [bookingSpot,    setBookingSpot]    = useState(null);
  const [parkingTimer,   setParkingTimer]   = useState(()=>ls.get('pe_timer', null));
  const [timerRemaining, setTimerRemaining] = useState(null);
  const [city,           setCity]           = useState(()=>ls.get('pe_city', 'belfast'));
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [userSpots,      setUserSpots]      = useState(()=>ls.get('pe_user_spots', []));

  const isIOS        = /ipad|iphone|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;

  const currentCity = CITIES.find(c => c.id === city) || CITIES[0];
  // Seeded spots for the city + any community spots the user has added there.
  const citySpots   = useMemo(
    () => [...userSpots.filter(s => s.city === currentCity.id), ...getCitySpots(currentCity.id)],
    [userSpots, currentCity.id]
  );
  // Everything addressable by id (used by Saved, which can hold community spots too).
  const allSpots    = useMemo(() => [...userSpots, ...SPOTS], [userSpots]);

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

  useEffect(() => {
    if (!parkingTimer) { setTimerRemaining(null); return; }
    const tick = () => {
      const remaining = Math.max(0, parkingTimer.endsAt - Date.now());
      setTimerRemaining(remaining);
      if (remaining === 0) {
        alert(`⏰ Your parking has expired at ${parkingTimer.name}!`);
        setParkingTimer(null);
        ls.set('pe_timer', null);
      } else if (remaining <= 15 * 60 * 1000 && !parkingTimer.alerted15) {
        alert(`⚠️ 15 minutes left at ${parkingTimer.name}!`);
        const updated = { ...parkingTimer, alerted15: true };
        setParkingTimer(updated);
        ls.set('pe_timer', updated);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [parkingTimer]);

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

  const toggleSave = (id) => {
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
    setVotes(prev => {
      if (prev[id]) return prev;
      const next = { ...prev, [id]: true };
      ls.set('pe_votes', next);
      return next;
    });
  };

  const handleBook = (spot) => setBookingSpot(spot);

  const confirmBooking = (booking) => {
    const saved = [booking, ...bookings];
    setBookings(saved);
    ls.set('pe_bookings', saved);
    const timer = { name: booking.spot.name, endsAt: Date.now() + booking.hours * 60 * 60 * 1000, alerted15: false };
    setParkingTimer(timer);
    ls.set('pe_timer', timer);
    setBookingSpot(null);
    setTab('bookings');
  };

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
    }
    // Premium is NOT granted here — only after you review and approve the spot.
    // You email the user a unique link: parkeasy.uk/?premium=success
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col" style={{maxWidth:680,margin:'0 auto'}}>
      {/* ── Modals ── */}
      {showWelcome  && <WelcomeModal onJoin={handleJoin} onSkip={handleSkip}/>}
      {showBizModal && <BusinessModal onClose={()=>setShowBizModal(false)}/>}
      {showPricing  && <PricingModal isPremium={isPremium} onClose={()=>setShowPricing(false)} onRedeem={redeemVipCode}/>}
      {showIOSGuide && <IOSGuide onClose={()=>setShowIOSGuide(false)}/>}
      {bookingSpot  && <BookingModal spot={bookingSpot} onClose={()=>setBookingSpot(null)} onConfirm={confirmBooking}/>}
      {showUserMenu && (
        <UserMenu user={user} spotsAdded={user?.spotsAdded||0} isPremium={isPremium}
          onSignOut={handleSignOut}
          onUpgrade={()=>{setShowUserMenu(false);setShowPricing(true);}}
          onClose={()=>setShowUserMenu(false)}/>
      )}

      {/* ── Header ── */}
      <header style={{background:'#1a2332', paddingTop:'env(safe-area-inset-top)'}} className="sticky top-0 z-50 shadow-lg">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 bg-[#4a9eff] rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
            <MapPin size={20} className="text-white" strokeWidth={2.5}/>
          </div>
          <div className="relative">
            <h1 className="text-white font-extrabold text-base leading-tight tracking-tight">ParkEasy</h1>
            {timerRemaining != null && timerRemaining > 0
              ? (
                <p className="text-[10px] font-bold flex items-center gap-1" style={{color: timerRemaining <= 15*60*1000 ? '#fbbf24' : '#4ade80'}}>
                  <Timer size={9}/>
                  {`${Math.floor(timerRemaining/60000).toString().padStart(2,'0')}:${Math.floor((timerRemaining%60000)/1000).toString().padStart(2,'0')} remaining`}
                </p>
              )
              : (
                <button onClick={()=>setShowCityPicker(v=>!v)}
                  className="text-blue-400 text-[10px] font-medium flex items-center gap-0.5 hover:text-blue-300 active:scale-95 transition">
                  {currentCity.name} · {citySpots.length} spot{citySpots.length!==1?'s':''}
                  <ChevronRight size={10} className={`transition-transform ${showCityPicker?'rotate-90':''}`}/>
                </button>
              )
            }
            {showCityPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={()=>setShowCityPicker(false)}/>
                <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50 w-48 max-h-72 overflow-y-auto">
                  {CITY_REGIONS.map(region=>(
                    <div key={region}>
                      <p className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-gray-400 bg-gray-50">{region}</p>
                      {CITIES.filter(c=>c.region===region).map(c=>(
                        <button key={c.id} onClick={()=>changeCity(c.id)}
                          className={`w-full text-left px-3 py-2.5 text-xs font-medium transition-colors hover:bg-gray-50 flex items-center justify-between ${c.id===currentCity.id?'text-[#4a9eff] font-bold':'text-gray-700'}`}>
                          {c.name}
                          {c.id===currentCity.id && <Check size={12}/>}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button onClick={()=>setTab('saved')}
              className={`relative w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 border border-white/20 ${
                tab==='saved' ? 'bg-[#4a9eff] text-white' : 'bg-white/10 text-white hover:bg-white/20'
              }`}>
              <Bookmark size={16} fill={tab==='saved' ? 'white' : 'none'}/>
              {saved.size > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-yellow-400 text-yellow-900 text-[9px] font-bold rounded-full flex items-center justify-center px-1">
                  {saved.size}
                </span>
              )}
            </button>
            {!isStandalone && (
              <button onClick={()=>isIOS ? setShowIOSGuide(true) : handleInstall()}
                className="text-[11px] bg-white/10 text-white px-2.5 py-1.5 rounded-full font-semibold hover:bg-white/20 active:scale-95 transition-all border border-white/20 flex items-center gap-1">
                <Download size={11}/>Install
              </button>
            )}
            {!isPremium && (
              <button onClick={()=>setShowPricing(true)}
                className="text-[11px] bg-yellow-400 text-yellow-900 px-2.5 py-1.5 rounded-full font-bold hover:bg-yellow-300 active:scale-95 transition-all shadow">
                ★ Premium
              </button>
            )}
            {user ? (
              <button onClick={()=>setShowUserMenu(v=>!v)}
                className="relative w-9 h-9 bg-[#4a9eff] rounded-full flex items-center justify-center text-white font-bold text-sm hover:bg-blue-400 active:scale-95 transition-all shadow">
                {user.name.charAt(0).toUpperCase()}
                {isPremium && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full flex items-center justify-center text-yellow-900 font-black shadow" style={{fontSize:8}}>★</span>
                )}
              </button>
            ) : (
              <button onClick={()=>setShowWelcome(true)}
                className="text-[11px] bg-white/10 text-white px-3 py-1.5 rounded-full font-semibold hover:bg-white/20 active:scale-95 transition-all border border-white/20">
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="flex-1 overflow-auto pb-24">
        {showInstall && !isStandalone && (
          <InstallBanner isIOS={isIOS} onInstall={handleInstall} onDismiss={()=>setShowInstall(false)}/>
        )}
        {tab==='search'     && <SearchTab saved={saved} onSave={toggleSave} ratings={ratings} onRate={rateSpot} votes={votes} onVote={voteSpot} onBook={handleBook} isPremium={isPremium} onUpgrade={()=>setShowPricing(true)} citySpots={citySpots} cityCenter={currentCity.center} cityName={currentCity.name}/>}
        {tab==='nearby'     && <NearbyTab saved={saved} onSave={toggleSave} ratings={ratings} onRate={rateSpot} votes={votes} onVote={voteSpot} onBook={handleBook} cityName={currentCity.name} onCityDetected={changeCity} userSpots={userSpots}/>}
        {tab==='businesses' && <BusinessesTab onGetListed={()=>setShowBizModal(true)}/>}
        {tab==='saved'      && <SavedTab saved={saved} onSave={toggleSave} ratings={ratings} onRate={rateSpot} votes={votes} onVote={voteSpot} onBook={handleBook} allSpots={allSpots}/>}
        {tab==='bookings'   && <BookingHistoryTab bookings={bookings}/>}
        {tab==='add'        && <AddSpotTab user={user} onJoinPrompt={()=>setShowWelcome(true)} onSpotAdded={handleSpotAdded}/>}
      </main>

      {/* ── Bottom Navigation ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-2xl" style={{maxWidth:680,margin:'0 auto'}}>
        <div className="flex" style={{paddingBottom:'env(safe-area-inset-bottom)'}}>
          {TABS.map(({id,label,Icon})=>{
            const active = tab===id;
            const pill   = id==='bookings' && bookings.length>0 ? bookings.length : null;
            return (
              <button key={id} onClick={()=>setTab(id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors active:bg-gray-50 ${
                  active ? 'text-[#4a9eff]' : 'text-gray-400 hover:text-gray-500'
                }`}>
                <div className="relative">
                  {active && (
                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-[#4a9eff] rounded-full"/>
                  )}
                  <Icon size={22} strokeWidth={active ? 2.5 : 1.8}/>
                  {pill && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 bg-[#4a9eff] text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
                      {pill}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-semibold ${active ? 'text-[#4a9eff]' : 'text-gray-400'}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
