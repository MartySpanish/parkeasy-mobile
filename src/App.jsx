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