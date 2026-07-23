// APCOA-operated / APCOA-managed car parks across Northern Ireland, found by a
// category research sweep (hospitals, rail, retail/town-centre, airports) and
// confirmed against APCOA's own location pages and the operating body's parking
// page. APCOA's *public* car-park footprint in NI is small — most of its NI
// presence is enforcement/management contracts — so this list is deliberately
// short and honest rather than padded. Merged per city via getCitySpots().
//
// Space counts are omitted where sources disagreed (better null than a wrong
// capacity). Coordinates are approximate from each site's postcode; drivers
// should confirm current tariffs on site or in the APCOA Connect app.
export const APCOA_SPOTS = {
  belfast: [
    { id:6000, name:"Lanyon Place Car Park (APCOA)", near:"Lanyon Place / Waterfront Hall, Belfast city centre", tags:["belfast","apcoa","lanyon-place","waterfront","city-centre","multi-storey","rail","ev-charging"], badge:"official", dist:0, walk:"Right there", restriction:"Paid multi-storey, open 24/7; barrierless ANPR — pay online or via the APCOA Connect app; 2.1m height limit", notes:"APCOA-operated multi-storey at 6 Lanyon Place, BT1 3LP, a short walk from Lanyon Place station and the Waterfront/ICC, with EV charging bays. Coordinates approximate from postcode. Source: https://www.apcoa.co.uk/parking-in/belfast/lanyon-place/", lat:54.5978, lng:-5.9161, by:"APCOA", votes:0, photo:null, price:"£4.70/hr", spaces:null, operator:"APCOA", partner:false, is_apcoa:true },
    { id:6001, name:"Oxford Street (Hilton) Car Park (APCOA)", near:"Oxford Street / Hilton Belfast, near St George's Market", tags:["belfast","apcoa","oxford-street","hilton","st-georges-market","city-centre","multi-storey"], badge:"official", dist:0, walk:"Right there", restriction:"Paid multi-storey, open 24/7; pay by app/QR or pre-book online (ANPR)", notes:"APCOA-operated multi-storey on Oxford Street beside the Hilton Belfast, close to the Waterfront/ICC and St George's Market. Coordinates approximate from BT1 3LP. Source: https://www.apcoa.co.uk/parking-in/belfast/oxford-street-hilton/", lat:54.5983, lng:-5.9225, by:"APCOA", votes:0, photo:null, price:"£4.10/hr", spaces:null, operator:"APCOA", partner:false, is_apcoa:true },
  ],
  newry: [
    { id:6002, name:"Daisy Hill Hospital Car Parks (APCOA)", near:"Daisy Hill Hospital, Hospital Road, Newry", tags:["newry","apcoa","daisy-hill","hospital","healthcare","pay-and-display"], badge:"paid", dist:0, walk:"Right there", restriction:"Pay & display (Car Park C machine); parking managed & enforced by APCOA. Car Park A is free overflow; blue-badge bays; regular long-term patients free", notes:"Daisy Hill Hospital car parks in Newry (BT35 8DR); the Southern Health & Social Care Trust contracts APCOA for parking management and enforcement. Charges run from £1.20 (up to 1hr) to £5.40 (8-24hr). Coordinates approximate from postcode. Source: https://southerntrust.hscni.net/our-hospitals/daisy-hill-hospital/parking-at-daisy-hill/", lat:54.1698, lng:-6.3512, by:"APCOA", votes:0, photo:null, price:"£1.20/hr up to £5.40/day", spaces:null, operator:"APCOA", partner:false, is_apcoa:true },
  ],
  craigavon: [
    { id:6003, name:"Craigavon Area Hospital Car Parks (APCOA)", near:"Craigavon Area Hospital, 68 Lurgan Road, Craigavon", tags:["craigavon","apcoa","hospital","healthcare","pay-and-display","lurgan-road"], badge:"paid", dist:0, walk:"Right there", restriction:"Pay & display in the four car parks nearest the hospital; managed & enforced by APCOA. Most other on-site spaces free; blue-badge & regular long-term patients free", notes:"Craigavon Area Hospital car parks (BT63 5QQ); the Southern Health & Social Care Trust contracts APCOA for parking management and enforcement. The four closest car parks charge £1.20 for the first hour then 60p/hr; PCNs are issued by APCOA. Coordinates approximate from postcode. Source: https://southerntrust.hscni.net/car-parking-update-for-daisy-hill-and-craigavon-hospitals/", lat:54.4365, lng:-6.3955, by:"APCOA", votes:0, photo:null, price:"£1.20 first hr, +60p/hr", spaces:null, operator:"APCOA", partner:false, is_apcoa:true },
  ],
};
