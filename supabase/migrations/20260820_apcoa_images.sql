-- APCOA: a logo and a photo on their partner card.
--
-- Both supplied by Marty from APCOA's own brand assets.
--
-- WHAT WAS EDITED OUT OF THE PHOTO, AND WHY IT HAD TO BE.
--
-- The image arrived as a still from an APCOA marketing video. Two blue signs
-- across the top of it read "Heathrow VALET PARKING".
--
-- Every APCOA site ParkEasy lists is in Northern Ireland, and not one of them
-- offers valet: Lanyon Place and Oxford Street are barrierless ANPR, Daisy Hill
-- and Craigavon are pay and display. That banner sits directly above a list of
-- those four car parks, so shipping it whole would have implied a service that
-- does not exist at any of them, at an airport 500 miles away. Cropped below
-- the signage — which keeps the multi-storey interior and the APCOA logo card,
-- and loses nothing the picture was there to say.
--
-- The number plate was also legible and is now blurred. A registration
-- identifies a keeper through the DVLA; this codebase masks VRNs in application
-- logs (api/corporate/_lib.js), and publishing one on the front of parkeasy.uk
-- would be the same data in a more visible place.
--
-- WORTH KNOWING: the source is 343x190, so the crop is 343x144. That is small
-- for a card banner and will look soft on a modern phone. If APCOA can supply
-- the original at ~1200px wide it should replace this one — same filename, no
-- other change needed.
update public.partners set
  logo_url   = 'https://parkeasy.uk/apcoa/logo.jpg',
  photo_url  = 'https://parkeasy.uk/apcoa/1-carpark.jpg',
  photo_urls = array['https://parkeasy.uk/apcoa/1-carpark.jpg']
where slug = 'apcoa';
