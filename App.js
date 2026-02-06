import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  StyleSheet,
  Platform,
  Share,
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Colors ─────────────────────────────────────────────────────────
const C = {
  blue50: '#EFF6FF',
  blue100: '#DBEAFE',
  blue500: '#3B82F6',
  blue600: '#2563EB',
  blue700: '#1D4ED8',
  blue900: '#1E3A8A',
  white: '#FFFFFF',
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray900: '#111827',
  red50: '#FEF2F2',
  red200: '#FECACA',
  red500: '#EF4444',
  red600: '#DC2626',
  red700: '#B91C1C',
  green50: '#F0FDF4',
  green500: '#22C55E',
  green600: '#16A34A',
  green700: '#15803D',
  yellow400: '#FACC15',
  yellow500: '#EAB308',
};

// ─── Context ────────────────────────────────────────────────────────
const AppContext = createContext();

const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};

// ─── Mock Parking Data ──────────────────────────────────────────────
const mockParkingSpots = [
  {
    id: 1,
    name: 'Downtown Plaza Parking',
    address: '123 Main St, Downtown',
    price: 8,
    type: 'paid',
    rating: 4.5,
    reviews: 127,
    distance: 0.3,
    availability: 15,
    totalSpots: 50,
    features: ['Covered', 'EV Charging', '24/7 Access'],
    image: 'https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=400&h=300&fit=crop',
  },
  {
    id: 2,
    name: 'City Center Garage',
    address: '456 Oak Ave, Midtown',
    price: 12,
    type: 'paid',
    rating: 4.2,
    reviews: 89,
    distance: 0.5,
    availability: 8,
    totalSpots: 100,
    features: ['Indoor', 'Security', 'Valet'],
    image: 'https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=400&h=300&fit=crop',
  },
  {
    id: 3,
    name: 'Street Parking - 5th Ave',
    address: '5th Avenue, Zone A',
    price: 0,
    type: 'free',
    rating: 3.8,
    reviews: 45,
    distance: 0.2,
    availability: 3,
    totalSpots: 20,
    features: ['Street Level', '2hr Limit'],
    image: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=400&h=300&fit=crop',
  },
  {
    id: 4,
    name: 'Riverside Parking Lot',
    address: '789 River Rd, Westside',
    price: 6,
    type: 'paid',
    rating: 4.7,
    reviews: 203,
    distance: 0.8,
    availability: 25,
    totalSpots: 75,
    features: ['Outdoor', 'Well-lit', 'CCTV'],
    image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop',
  },
  {
    id: 5,
    name: 'Metro Station Parking',
    address: '321 Transit Blvd, Station District',
    price: 10,
    type: 'paid',
    rating: 4.0,
    reviews: 156,
    distance: 1.2,
    availability: 40,
    totalSpots: 200,
    features: ['Multi-level', 'Shuttle Service', 'Monthly Pass'],
    image: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&h=300&fit=crop',
  },
  {
    id: 6,
    name: 'Park & Walk - Elm Street',
    address: 'Elm Street, Historic Quarter',
    price: 0,
    type: 'free',
    rating: 3.5,
    reviews: 32,
    distance: 0.6,
    availability: 5,
    totalSpots: 15,
    features: ['Street Parking', 'No Time Limit'],
    image: 'https://images.unsplash.com/photo-1519125323398-675f0ddb6308?w=400&h=300&fit=crop',
  },
];

// ─── Helper: generate next 7 days ──────────────────────────────────
const getNextDays = (count = 7) => {
  const days = [];
  const today = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
};

const formatDateShort = (date) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    day: days[date.getDay()],
    date: date.getDate(),
    month: months[date.getMonth()],
    full: date.toISOString().split('T')[0],
  };
};

const formatDateLong = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

// Time slots for booking
const TIME_SLOTS = [
  '6:00 AM', '6:30 AM', '7:00 AM', '7:30 AM',
  '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM',
  '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM',
  '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM',
  '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM',
  '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM',
  '8:00 PM', '8:30 PM', '9:00 PM', '9:30 PM',
  '10:00 PM',
];

// ─── App Provider ───────────────────────────────────────────────────
const AppProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [currentScreen, setCurrentScreen] = useState('login');
  const [favorites, setFavorites] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [isOnline, setIsOnline] = useState(true);
  const [selectedParking, setSelectedParking] = useState(null);
  const [bookingData, setBookingData] = useState(null);

  const login = (email, password) => {
    if (email && password) {
      setUser({ email, name: email.split('@')[0] });
      setCurrentScreen('home');
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    setCurrentScreen('login');
    setFavorites([]);
    setBookings([]);
  };

  const toggleFavorite = (parkingId) => {
    setFavorites((prev) =>
      prev.includes(parkingId)
        ? prev.filter((id) => id !== parkingId)
        : [...prev, parkingId]
    );
  };

  const addBooking = (booking) => {
    setBookings((prev) => [...prev, { ...booking, id: Date.now() }]);
  };

  return (
    <AppContext.Provider
      value={{
        user,
        currentScreen,
        setCurrentScreen,
        favorites,
        toggleFavorite,
        bookings,
        addBooking,
        isOnline,
        login,
        logout,
        selectedParking,
        setSelectedParking,
        bookingData,
        setBookingData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

// ─── Login Screen ───────────────────────────────────────────────────
const LoginScreen = () => {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    setError('');
    setLoading(true);
    setTimeout(() => {
      if (login(email, password)) {
        setLoading(false);
      } else {
        setError('Please enter both email and password');
        setLoading(false);
      }
    }, 1000);
  };

  return (
    <LinearGradient colors={[C.blue500, C.blue700]} style={s.flex1}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.loginContainer}
      >
        <View style={s.loginCard}>
          <View style={s.loginIconWrap}>
            <Ionicons name="location-sharp" size={32} color={C.white} />
          </View>
          <Text style={s.loginTitle}>ParkFinder</Text>
          <Text style={s.loginSubtitle}>Find parking spots near you</Text>

          <View style={s.inputGroup}>
            <Text style={s.inputLabel}>Email Address</Text>
            <TextInput
              style={s.input}
              placeholder="you@example.com"
              placeholderTextColor={C.gray400}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={s.inputGroup}>
            <Text style={s.inputLabel}>Password</Text>
            <TextInput
              style={s.input}
              placeholder="Enter your password"
              placeholderTextColor={C.gray400}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          {error ? (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[s.loginBtn, loading && s.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={C.white} />
            ) : (
              <Text style={s.loginBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <Text style={s.loginHint}>
            Demo: Use any email and password to login
          </Text>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

// ─── Parking Card ───────────────────────────────────────────────────
const ParkingCard = ({ spot, isFavorite, onPress }) => {
  const { toggleFavorite } = useApp();

  return (
    <TouchableOpacity
      style={s.card}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <View style={s.cardImageWrap}>
        <Image source={{ uri: spot.image }} style={s.cardImage} />
        <TouchableOpacity
          style={s.cardFavBtn}
          onPress={() => toggleFavorite(spot.id)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={22}
            color={isFavorite ? C.red500 : C.gray400}
          />
        </TouchableOpacity>
        <View style={s.cardPriceBadge}>
          <Text style={s.cardPriceText}>
            {spot.type === 'free' ? 'FREE' : `$${spot.price}/hr`}
          </Text>
        </View>
      </View>

      <View style={s.cardBody}>
        <Text style={s.cardName}>{spot.name}</Text>
        <View style={s.cardAddressRow}>
          <Ionicons name="location-outline" size={14} color={C.gray500} />
          <Text style={s.cardAddress}>
            {spot.address} · {spot.distance} mi
          </Text>
        </View>

        <View style={s.cardMeta}>
          <View style={s.cardRating}>
            <Ionicons name="star" size={14} color={C.yellow400} />
            <Text style={s.cardRatingNum}>{spot.rating}</Text>
            <Text style={s.cardReviews}>({spot.reviews})</Text>
          </View>
          <Text
            style={[
              s.cardAvail,
              spot.availability < 5 ? s.cardAvailLow : s.cardAvailOk,
            ]}
          >
            {spot.availability} spots available
          </Text>
        </View>

        <View style={s.cardFeatures}>
          {spot.features.slice(0, 3).map((f, i) => (
            <View key={i} style={s.featureChip}>
              <Text style={s.featureChipText}>{f}</Text>
            </View>
          ))}
        </View>
      </View>
    </TouchableOpacity>
  );
};

// ─── Map View Placeholder ───────────────────────────────────────────
const MapViewPlaceholder = ({ spots, onSelectSpot }) => (
  <View style={s.mapPlaceholder}>
    <View style={s.mapPlaceholderInner}>
      <Ionicons name="location-sharp" size={56} color={C.blue600} />
      <Text style={s.mapPlaceholderTitle}>Interactive Map View</Text>
      <Text style={s.mapPlaceholderSub}>
        Map functionality would be displayed here
      </Text>
      <Text style={s.mapPlaceholderCount}>
        Showing {spots.length} parking locations
      </Text>
    </View>
    {spots.map((spot) => (
      <TouchableOpacity
        key={spot.id}
        style={s.mapSpotItem}
        onPress={() => onSelectSpot(spot)}
        activeOpacity={0.7}
      >
        <View style={s.mapSpotInfo}>
          <Text style={s.mapSpotName}>{spot.name}</Text>
          <Text style={s.mapSpotDist}>{spot.distance} mi away</Text>
        </View>
        <Text style={s.mapSpotPrice}>
          {spot.type === 'free' ? 'FREE' : `$${spot.price}`}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

// ─── Home Screen ────────────────────────────────────────────────────
const HomeScreen = () => {
  const { setCurrentScreen, setSelectedParking, favorites, isOnline } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterRadius, setFilterRadius] = useState(5);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState('list');

  const filteredSpots = mockParkingSpots.filter((spot) => {
    const matchesSearch =
      spot.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      spot.address.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || spot.type === filterType;
    const matchesRadius = spot.distance <= filterRadius;
    return matchesSearch && matchesType && matchesRadius;
  });

  const handleSelectParking = (spot) => {
    setSelectedParking(spot);
    setCurrentScreen('detail');
  };

  return (
    <SafeAreaView style={s.flex1} edges={['top']}>
      <StatusBar style="dark" />
      <View style={s.flex1Bg}>
        {!isOnline && (
          <View style={s.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color={C.white} />
            <Text style={s.offlineText}>
              You are offline. Showing cached results.
            </Text>
          </View>
        )}

        {/* Header */}
        <View style={s.homeHeader}>
          <View style={s.homeHeaderTop}>
            <View style={s.homeLogoRow}>
              <Ionicons name="location-sharp" size={24} color={C.blue600} />
              <Text style={s.homeTitle}>ParkFinder</Text>
            </View>
            <TouchableOpacity
              style={s.profileBtn}
              onPress={() => setCurrentScreen('profile')}
            >
              <Ionicons name="person-outline" size={24} color={C.gray600} />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={s.searchWrap}>
            <Ionicons
              name="search"
              size={20}
              color={C.gray400}
              style={s.searchIcon}
            />
            <TextInput
              style={s.searchInput}
              placeholder="Search parking spots..."
              placeholderTextColor={C.gray400}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={20} color={C.gray400} />
              </TouchableOpacity>
            )}
          </View>

          {/* Filter + View Toggle */}
          <View style={s.filterRow}>
            <TouchableOpacity
              style={s.filterBtn}
              onPress={() => setShowFilters(!showFilters)}
            >
              <Ionicons name="options-outline" size={18} color={C.gray700} />
              <Text style={s.filterBtnText}>Filters</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.viewToggleBtn}
              onPress={() =>
                setViewMode(viewMode === 'list' ? 'map' : 'list')
              }
            >
              <Ionicons name="location-outline" size={18} color={C.white} />
              <Text style={s.viewToggleText}>
                {viewMode === 'list' ? 'Map View' : 'List View'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Filters Panel */}
          {showFilters && (
            <View style={s.filtersPanel}>
              <Text style={s.filterLabel}>Parking Type</Text>
              <View style={s.filterTypeRow}>
                {['all', 'free', 'paid'].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      s.filterTypeBtn,
                      filterType === type && s.filterTypeBtnActive,
                    ]}
                    onPress={() => setFilterType(type)}
                  >
                    <Text
                      style={[
                        s.filterTypeBtnText,
                        filterType === type && s.filterTypeBtnTextActive,
                      ]}
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[s.filterLabel, { marginTop: 16 }]}>
                Radius: {filterRadius} miles
              </Text>
              <View style={s.radiusRow}>
                <TouchableOpacity
                  style={s.radiusBtn}
                  onPress={() => setFilterRadius(Math.max(1, filterRadius - 1))}
                >
                  <Text style={s.radiusBtnText}>-</Text>
                </TouchableOpacity>
                <View style={s.radiusDisplay}>
                  <Text style={s.radiusValue}>{filterRadius}</Text>
                  <Text style={s.radiusUnit}>mi</Text>
                </View>
                <TouchableOpacity
                  style={s.radiusBtn}
                  onPress={() =>
                    setFilterRadius(Math.min(10, filterRadius + 1))
                  }
                >
                  <Text style={s.radiusBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Content */}
        <ScrollView
          style={s.flex1}
          contentContainerStyle={s.homeContent}
          showsVerticalScrollIndicator={false}
        >
          {viewMode === 'list' ? (
            <>
              <Text style={s.resultCount}>
                {filteredSpots.length} parking spots found
              </Text>
              {filteredSpots.map((spot) => (
                <ParkingCard
                  key={spot.id}
                  spot={spot}
                  isFavorite={favorites.includes(spot.id)}
                  onPress={() => handleSelectParking(spot)}
                />
              ))}
              <View style={{ height: 20 }} />
            </>
          ) : (
            <MapViewPlaceholder
              spots={filteredSpots}
              onSelectSpot={handleSelectParking}
            />
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

// ─── Detail Screen ──────────────────────────────────────────────────
const DetailScreen = () => {
  const {
    selectedParking,
    setCurrentScreen,
    favorites,
    toggleFavorite,
    setBookingData,
  } = useApp();

  if (!selectedParking) {
    setCurrentScreen('home');
    return null;
  }

  const handleBookNow = () => {
    setBookingData({
      parking: selectedParking,
      date: null,
      startTime: null,
      duration: 2,
      paymentMethod: null,
    });
    setCurrentScreen('booking');
  };

  return (
    <SafeAreaView style={s.flex1} edges={['top']}>
      <StatusBar style="dark" />
      {/* Header */}
      <View style={s.screenHeader}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => setCurrentScreen('home')}
        >
          <Ionicons name="chevron-back" size={24} color={C.gray900} />
        </TouchableOpacity>
        <Text style={s.screenHeaderTitle}>Parking Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={s.flex1}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Image */}
        <View style={s.detailImageWrap}>
          <Image
            source={{ uri: selectedParking.image }}
            style={s.detailImage}
          />
          <TouchableOpacity
            style={s.detailFavBtn}
            onPress={() => toggleFavorite(selectedParking.id)}
          >
            <Ionicons
              name={
                favorites.includes(selectedParking.id)
                  ? 'heart'
                  : 'heart-outline'
              }
              size={24}
              color={
                favorites.includes(selectedParking.id) ? C.red500 : C.gray400
              }
            />
          </TouchableOpacity>
        </View>

        {/* Main Info */}
        <View style={s.detailSection}>
          <View style={s.detailTopRow}>
            <View style={s.flex1}>
              <Text style={s.detailName}>{selectedParking.name}</Text>
              <View style={s.detailAddressRow}>
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={C.gray500}
                />
                <Text style={s.detailAddress}>{selectedParking.address}</Text>
              </View>
            </View>
            <View style={s.detailPriceBox}>
              <Text style={s.detailPrice}>
                {selectedParking.type === 'free'
                  ? 'FREE'
                  : `$${selectedParking.price}`}
              </Text>
              {selectedParking.type !== 'free' && (
                <Text style={s.detailPriceUnit}>per hour</Text>
              )}
            </View>
          </View>

          <View style={s.detailStatsRow}>
            <View style={s.detailStat}>
              <Ionicons name="star" size={18} color={C.yellow400} />
              <Text style={s.detailStatBold}>{selectedParking.rating}</Text>
              <Text style={s.detailStatLight}>
                ({selectedParking.reviews} reviews)
              </Text>
            </View>
            <View style={s.detailStat}>
              <Ionicons name="navigate-outline" size={18} color={C.gray500} />
              <Text style={s.detailStatLight}>
                {selectedParking.distance} mi away
              </Text>
            </View>
          </View>

          <View
            style={[
              s.detailAvailBadge,
              selectedParking.availability < 5
                ? s.detailAvailBadgeLow
                : s.detailAvailBadgeOk,
            ]}
          >
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={selectedParking.availability < 5 ? C.red700 : C.green700}
            />
            <Text
              style={[
                s.detailAvailText,
                selectedParking.availability < 5
                  ? { color: C.red700 }
                  : { color: C.green700 },
              ]}
            >
              {selectedParking.availability} of {selectedParking.totalSpots}{' '}
              spots available
            </Text>
          </View>
        </View>

        {/* Features */}
        <View style={s.detailSection}>
          <Text style={s.sectionTitle}>Features & Amenities</Text>
          {selectedParking.features.map((feature, idx) => (
            <View key={idx} style={s.featureRow}>
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={C.green600}
              />
              <Text style={s.featureText}>{feature}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Fixed Book Button */}
      <View style={s.fixedBottomBtn}>
        <TouchableOpacity
          style={s.bookBtn}
          onPress={handleBookNow}
          activeOpacity={0.8}
        >
          <Text style={s.bookBtnText}>Book This Spot</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

// ─── Booking Screen ─────────────────────────────────────────────────
const BookingScreen = () => {
  const { bookingData, setCurrentScreen, addBooking } = useApp();
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [duration, setDuration] = useState(2);
  const [paymentMethod, setPaymentMethod] = useState('');

  const nextDays = getNextDays(7);

  if (!bookingData) {
    setCurrentScreen('home');
    return null;
  }

  const totalPrice =
    bookingData.parking.type === 'free'
      ? 0
      : bookingData.parking.price * duration;
  const commission = totalPrice * 0.1;
  const finalPrice = totalPrice + commission;

  const handleNext = () => {
    if (step === 1 && selectedDate && selectedTime) {
      setStep(2);
    } else if (step === 2 && paymentMethod) {
      setStep(3);
    }
  };

  const handleConfirm = () => {
    const booking = {
      parking: bookingData.parking,
      date: selectedDate,
      time: selectedTime,
      duration,
      paymentMethod,
      totalPrice: finalPrice,
      commission,
      bookingDate: new Date().toISOString(),
    };
    addBooking(booking);
    setCurrentScreen('receipt');
  };

  return (
    <SafeAreaView style={s.flex1} edges={['top']}>
      <StatusBar style="dark" />
      {/* Header */}
      <View style={s.screenHeader}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() =>
            step > 1 ? setStep(step - 1) : setCurrentScreen('detail')
          }
        >
          <Ionicons name="chevron-back" size={24} color={C.gray900} />
        </TouchableOpacity>
        <Text style={s.screenHeaderTitle}>Book Parking</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Progress Steps */}
      <View style={s.progressRow}>
        {[1, 2, 3].map((num) => (
          <React.Fragment key={num}>
            <View
              style={[
                s.progressDot,
                step >= num ? s.progressDotActive : s.progressDotInactive,
              ]}
            >
              <Text
                style={[
                  s.progressDotText,
                  step >= num
                    ? s.progressDotTextActive
                    : s.progressDotTextInactive,
                ]}
              >
                {num}
              </Text>
            </View>
            {num < 3 && (
              <View
                style={[
                  s.progressLine,
                  step > num
                    ? s.progressLineActive
                    : s.progressLineInactive,
                ]}
              />
            )}
          </React.Fragment>
        ))}
      </View>
      <View style={s.progressLabels}>
        <Text style={s.progressLabel}>Date & Time</Text>
        <Text style={s.progressLabel}>Payment</Text>
        <Text style={s.progressLabel}>Confirm</Text>
      </View>

      <ScrollView
        style={s.flex1}
        contentContainerStyle={s.bookingContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Step 1: Date & Time */}
        {step === 1 && (
          <>
            {/* Date Selection */}
            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>Select Date</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.dateRow}
              >
                {nextDays.map((d) => {
                  const info = formatDateShort(d);
                  const isSelected = selectedDate === info.full;
                  const isToday =
                    info.full === formatDateShort(new Date()).full;
                  return (
                    <TouchableOpacity
                      key={info.full}
                      style={[
                        s.dateChip,
                        isSelected && s.dateChipSelected,
                      ]}
                      onPress={() => setSelectedDate(info.full)}
                    >
                      <Text
                        style={[
                          s.dateChipDay,
                          isSelected && s.dateChipTextSelected,
                        ]}
                      >
                        {isToday ? 'Today' : info.day}
                      </Text>
                      <Text
                        style={[
                          s.dateChipDate,
                          isSelected && s.dateChipTextSelected,
                        ]}
                      >
                        {info.date}
                      </Text>
                      <Text
                        style={[
                          s.dateChipMonth,
                          isSelected && s.dateChipTextSelected,
                        ]}
                      >
                        {info.month}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Time Selection */}
            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>Select Time</Text>
              <View style={s.timeGrid}>
                {TIME_SLOTS.map((time) => (
                  <TouchableOpacity
                    key={time}
                    style={[
                      s.timeChip,
                      selectedTime === time && s.timeChipSelected,
                    ]}
                    onPress={() => setSelectedTime(time)}
                  >
                    <Text
                      style={[
                        s.timeChipText,
                        selectedTime === time && s.timeChipTextSelected,
                      ]}
                    >
                      {time}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Duration */}
            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>Duration</Text>
              <View style={s.durationRow}>
                <TouchableOpacity
                  style={s.durationBtn}
                  onPress={() => setDuration(Math.max(1, duration - 1))}
                >
                  <Text style={s.durationBtnText}>-</Text>
                </TouchableOpacity>
                <View style={s.durationDisplay}>
                  <Text style={s.durationValue}>{duration}</Text>
                  <Text style={s.durationUnit}>
                    hour{duration !== 1 ? 's' : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={s.durationBtn}
                  onPress={() => setDuration(Math.min(24, duration + 1))}
                >
                  <Text style={s.durationBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Price Summary */}
            <View style={s.sectionCard}>
              <View style={s.priceRow}>
                <Text style={s.priceLabel}>Parking Rate</Text>
                <Text style={s.priceValue2}>
                  {bookingData.parking.type === 'free'
                    ? 'FREE'
                    : `$${bookingData.parking.price}/hr`}
                </Text>
              </View>
              <View style={s.priceRow}>
                <Text style={s.priceLabel}>Duration</Text>
                <Text style={s.priceValue2}>
                  {duration} hour{duration !== 1 ? 's' : ''}
                </Text>
              </View>
              <View style={s.priceDivider} />
              <View style={s.priceRow}>
                <Text style={s.priceTotalLabel}>Subtotal</Text>
                <Text style={s.priceTotalValue}>
                  ${totalPrice.toFixed(2)}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                s.primaryBtn,
                (!selectedDate || !selectedTime) && s.primaryBtnDisabled,
              ]}
              onPress={handleNext}
              disabled={!selectedDate || !selectedTime}
              activeOpacity={0.8}
            >
              <Text style={s.primaryBtnText}>Continue to Payment</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Step 2: Payment */}
        {step === 2 && (
          <>
            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>Select Payment Method</Text>
              {[
                { id: 'card', name: 'Credit/Debit Card', icon: 'card-outline' },
                { id: 'apple', name: 'Apple Pay', icon: 'logo-apple' },
                { id: 'google', name: 'Google Pay', icon: 'logo-google' },
              ].map((method) => (
                <TouchableOpacity
                  key={method.id}
                  style={[
                    s.paymentOption,
                    paymentMethod === method.id && s.paymentOptionSelected,
                  ]}
                  onPress={() => setPaymentMethod(method.id)}
                >
                  <Ionicons
                    name={method.icon}
                    size={24}
                    color={C.gray700}
                  />
                  <Text style={s.paymentOptionText}>{method.name}</Text>
                  {paymentMethod === method.id && (
                    <Ionicons
                      name="checkmark-circle"
                      size={24}
                      color={C.blue600}
                      style={{ marginLeft: 'auto' }}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>Price Breakdown</Text>
              <View style={s.priceRow}>
                <Text style={s.priceLabel}>Parking ({duration}hr)</Text>
                <Text style={s.priceValue2}>${totalPrice.toFixed(2)}</Text>
              </View>
              <View style={s.priceRow}>
                <Text style={s.priceLabel}>Service Fee (10%)</Text>
                <Text style={s.priceValue2}>${commission.toFixed(2)}</Text>
              </View>
              <View style={s.priceDivider} />
              <View style={s.priceRow}>
                <Text style={s.priceTotalLabel}>Total</Text>
                <Text style={s.priceTotalValue}>
                  ${finalPrice.toFixed(2)}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                s.primaryBtn,
                !paymentMethod && s.primaryBtnDisabled,
              ]}
              onPress={handleNext}
              disabled={!paymentMethod}
              activeOpacity={0.8}
            >
              <Text style={s.primaryBtnText}>Review Booking</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Step 3: Confirmation */}
        {step === 3 && (
          <>
            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>Booking Summary</Text>

              <Text style={s.summaryLabel}>Location</Text>
              <Text style={s.summaryValue}>{bookingData.parking.name}</Text>
              <Text style={s.summarySubValue}>
                {bookingData.parking.address}
              </Text>

              <View style={s.summaryDivider} />

              <Text style={s.summaryLabel}>Date & Time</Text>
              <Text style={s.summaryValue}>
                {formatDateLong(selectedDate)}
              </Text>
              <Text style={s.summarySubValue}>
                {selectedTime} · {duration} hour{duration !== 1 ? 's' : ''}
              </Text>

              <View style={s.summaryDivider} />

              <Text style={s.summaryLabel}>Payment Method</Text>
              <Text style={[s.summaryValue, { textTransform: 'capitalize' }]}>
                {paymentMethod === 'card'
                  ? 'Credit/Debit Card'
                  : paymentMethod === 'apple'
                  ? 'Apple Pay'
                  : 'Google Pay'}
              </Text>

              <View style={s.summaryDivider} />

              <View style={s.priceRow}>
                <Text style={s.priceLabel}>Parking Fee</Text>
                <Text style={s.priceValue2}>${totalPrice.toFixed(2)}</Text>
              </View>
              <View style={s.priceRow}>
                <Text style={s.priceLabel}>Service Fee (10%)</Text>
                <Text style={s.priceValue2}>${commission.toFixed(2)}</Text>
              </View>
              <View style={s.priceDivider} />
              <View style={s.priceRow}>
                <Text style={s.priceTotalLabel}>Total Amount</Text>
                <Text style={s.priceTotalValue}>
                  ${finalPrice.toFixed(2)}
                </Text>
              </View>
            </View>

            <View style={s.infoBox}>
              <Ionicons
                name="information-circle"
                size={20}
                color={C.blue600}
              />
              <View style={s.infoBoxContent}>
                <Text style={s.infoBoxTitle}>Cancellation Policy</Text>
                <Text style={s.infoBoxText}>
                  Free cancellation up to 1 hour before your booking starts.
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={s.primaryBtn}
              onPress={handleConfirm}
              activeOpacity={0.8}
            >
              <Text style={s.primaryBtnText}>
                Confirm & Pay ${finalPrice.toFixed(2)}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Receipt Screen ─────────────────────────────────────────────────
const ReceiptScreen = () => {
  const { bookings, setCurrentScreen } = useApp();
  const latestBooking = bookings[bookings.length - 1];

  if (!latestBooking) {
    setCurrentScreen('home');
    return null;
  }

  const handleShare = async () => {
    try {
      await Share.share({
        message: `ParkFinder Booking Confirmed!\n\nLocation: ${latestBooking.parking.name}\nDate: ${latestBooking.date}\nTime: ${latestBooking.time}\nDuration: ${latestBooking.duration} hours\nTotal: $${latestBooking.totalPrice.toFixed(2)}\n\nBooking ID: #${latestBooking.id}`,
      });
    } catch (e) {
      // User cancelled share
    }
  };

  return (
    <SafeAreaView style={s.flex1} edges={['top']}>
      <StatusBar style="light" />
      <ScrollView
        style={s.flex1}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Success Header */}
        <LinearGradient
          colors={[C.green500, C.green600]}
          style={s.receiptHeader}
        >
          <View style={s.receiptCheckCircle}>
            <Ionicons name="checkmark" size={44} color={C.green600} />
          </View>
          <Text style={s.receiptTitle}>Booking Confirmed!</Text>
          <Text style={s.receiptSubtitle}>
            Your parking spot has been reserved
          </Text>
        </LinearGradient>

        <View style={s.receiptBody}>
          {/* Booking ID */}
          <View style={s.receiptRow}>
            <Text style={s.receiptLabel}>BOOKING ID</Text>
            <Text style={s.receiptId}>#{latestBooking.id}</Text>
          </View>

          <View style={s.receiptDivider} />

          <View style={s.receiptRow}>
            <Text style={s.receiptLabel}>LOCATION</Text>
            <Text style={s.receiptValue}>
              {latestBooking.parking.name}
            </Text>
            <Text style={s.receiptSubValue}>
              {latestBooking.parking.address}
            </Text>
          </View>

          <View style={s.receiptDivider} />

          <View style={s.receiptRow}>
            <Text style={s.receiptLabel}>DATE & TIME</Text>
            <View style={s.receiptIconRow}>
              <Ionicons name="calendar-outline" size={18} color={C.gray600} />
              <Text style={s.receiptValue}>
                {formatDateLong(latestBooking.date)}
              </Text>
            </View>
            <View style={[s.receiptIconRow, { marginTop: 6 }]}>
              <Ionicons name="time-outline" size={18} color={C.gray600} />
              <Text style={s.receiptValue}>
                {latestBooking.time} · {latestBooking.duration} hour
                {latestBooking.duration !== 1 ? 's' : ''}
              </Text>
            </View>
          </View>

          <View style={s.receiptDivider} />

          <View style={s.receiptRow}>
            <Text style={s.receiptLabel}>PAYMENT DETAILS</Text>
            <View style={s.priceRow}>
              <Text style={s.priceLabel}>Parking Fee</Text>
              <Text style={s.priceValue2}>
                $
                {(
                  latestBooking.totalPrice - latestBooking.commission
                ).toFixed(2)}
              </Text>
            </View>
            <View style={s.priceRow}>
              <Text style={s.priceLabel}>Service Fee (10%)</Text>
              <Text style={s.priceValue2}>
                ${latestBooking.commission.toFixed(2)}
              </Text>
            </View>
            <View style={s.priceRow}>
              <Text style={s.priceLabel}>Payment Method</Text>
              <Text style={[s.priceValue2, { textTransform: 'capitalize' }]}>
                {latestBooking.paymentMethod}
              </Text>
            </View>
            <View style={s.priceDivider} />
            <View style={s.priceRow}>
              <Text style={s.priceTotalLabel}>Total Paid</Text>
              <Text style={[s.priceTotalValue, { color: C.green600 }]}>
                ${latestBooking.totalPrice.toFixed(2)}
              </Text>
            </View>
          </View>

          <View style={s.receiptInfoBox}>
            <Text style={s.receiptInfoTitle}>Important Information:</Text>
            <Text style={s.receiptInfoItem}>
              {'\u2022'} Please arrive on time for your reservation
            </Text>
            <Text style={s.receiptInfoItem}>
              {'\u2022'} Present this booking ID at the parking entrance
            </Text>
            <Text style={s.receiptInfoItem}>
              {'\u2022'} Free cancellation up to 1 hour before start time
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View style={s.receiptActions}>
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() => setCurrentScreen('home')}
            activeOpacity={0.8}
          >
            <Text style={s.primaryBtnText}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={handleShare}
            activeOpacity={0.8}
          >
            <Ionicons name="share-outline" size={20} color={C.gray700} />
            <Text style={s.secondaryBtnText}>Share Receipt</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Profile Screen ─────────────────────────────────────────────────
const ProfileScreen = () => {
  const { user, logout, setCurrentScreen, bookings, favorites } = useApp();

  return (
    <SafeAreaView style={s.flex1} edges={['top']}>
      <StatusBar style="dark" />
      {/* Header */}
      <View style={s.screenHeader}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => setCurrentScreen('home')}
        >
          <Ionicons name="chevron-back" size={24} color={C.gray900} />
        </TouchableOpacity>
        <Text style={s.screenHeaderTitle}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={s.flex1}
        contentContainerStyle={s.profileContent}
        showsVerticalScrollIndicator={false}
      >
        {/* User Info */}
        <View style={s.profileCard}>
          <View style={s.profileAvatar}>
            <Ionicons name="person" size={40} color={C.white} />
          </View>
          <View style={s.profileInfo}>
            <Text style={s.profileName}>{user?.name}</Text>
            <Text style={s.profileEmail}>{user?.email}</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statNumber}>{bookings.length}</Text>
            <Text style={s.statLabel}>Total Bookings</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNumber}>{favorites.length}</Text>
            <Text style={s.statLabel}>Favorites</Text>
          </View>
        </View>

        {/* Recent Bookings */}
        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Recent Bookings</Text>
          {bookings.length > 0 ? (
            bookings
              .slice(-5)
              .reverse()
              .map((booking) => (
                <View key={booking.id} style={s.bookingItem}>
                  <View style={s.bookingItemTop}>
                    <Text style={s.bookingItemName}>
                      {booking.parking.name}
                    </Text>
                    <Text style={s.bookingItemPrice}>
                      ${booking.totalPrice.toFixed(2)}
                    </Text>
                  </View>
                  <Text style={s.bookingItemDate}>
                    {new Date(booking.date).toLocaleDateString()} ·{' '}
                    {booking.time}
                  </Text>
                  <Text style={s.bookingItemId}>
                    Booking ID: #{booking.id}
                  </Text>
                </View>
              ))
          ) : (
            <Text style={s.emptyText}>No bookings yet</Text>
          )}
        </View>

        {/* Favorites */}
        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Favorite Spots</Text>
          {favorites.length > 0 ? (
            favorites.map((id) => {
              const spot = mockParkingSpots.find((sp) => sp.id === id);
              return spot ? (
                <View key={id} style={s.favItem}>
                  <View>
                    <Text style={s.favItemName}>{spot.name}</Text>
                    <Text style={s.favItemAddress}>{spot.address}</Text>
                  </View>
                  <Ionicons name="heart" size={20} color={C.red500} />
                </View>
              ) : null;
            })
          ) : (
            <Text style={s.emptyText}>No favorites yet</Text>
          )}
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={s.logoutBtn}
          onPress={logout}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={20} color={C.white} />
          <Text style={s.logoutBtnText}>Logout</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Main Navigator ─────────────────────────────────────────────────
const ParkingFinderApp = () => {
  const { currentScreen } = useApp();

  switch (currentScreen) {
    case 'login':
      return <LoginScreen />;
    case 'home':
      return <HomeScreen />;
    case 'detail':
      return <DetailScreen />;
    case 'booking':
      return <BookingScreen />;
    case 'receipt':
      return <ReceiptScreen />;
    case 'profile':
      return <ProfileScreen />;
    default:
      return <LoginScreen />;
  }
};

// ─── App Entry Point ────────────────────────────────────────────────
export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <ParkingFinderApp />
      </AppProvider>
    </SafeAreaProvider>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const s = StyleSheet.create({
  flex1: {
    flex: 1,
  },
  flex1Bg: {
    flex: 1,
    backgroundColor: C.gray50,
  },

  // ── Login ─────────────────────────────────────────
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loginCard: {
    backgroundColor: C.white,
    borderRadius: 20,
    padding: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  loginIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.blue600,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  loginTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: C.gray900,
    textAlign: 'center',
    marginBottom: 4,
  },
  loginSubtitle: {
    fontSize: 15,
    color: C.gray500,
    textAlign: 'center',
    marginBottom: 28,
  },
  inputGroup: {
    marginBottom: 18,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: C.gray700,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: C.gray300,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: C.gray900,
    backgroundColor: C.white,
  },
  errorBox: {
    backgroundColor: C.red50,
    borderWidth: 1,
    borderColor: C.red200,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  errorText: {
    color: C.red700,
    fontSize: 14,
  },
  loginBtn: {
    backgroundColor: C.blue600,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  loginBtnDisabled: {
    opacity: 0.5,
  },
  loginBtnText: {
    color: C.white,
    fontSize: 17,
    fontWeight: '600',
  },
  loginHint: {
    textAlign: 'center',
    color: C.gray500,
    fontSize: 13,
    marginTop: 16,
  },

  // ── Home ──────────────────────────────────────────
  offlineBanner: {
    backgroundColor: C.yellow500,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  offlineText: {
    color: C.white,
    fontSize: 13,
    fontWeight: '500',
  },
  homeHeader: {
    backgroundColor: C.white,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  homeHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  homeLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: C.gray900,
  },
  profileBtn: {
    padding: 8,
    borderRadius: 20,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.gray50,
    borderWidth: 1,
    borderColor: C.gray300,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: C.gray900,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.gray100,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  filterBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: C.gray700,
  },
  viewToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.blue600,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  viewToggleText: {
    fontSize: 14,
    fontWeight: '500',
    color: C.white,
  },
  filtersPanel: {
    marginTop: 12,
    backgroundColor: C.gray50,
    borderRadius: 10,
    padding: 16,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: C.gray700,
    marginBottom: 8,
  },
  filterTypeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterTypeBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.white,
  },
  filterTypeBtnActive: {
    backgroundColor: C.blue600,
  },
  filterTypeBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: C.gray700,
  },
  filterTypeBtnTextActive: {
    color: C.white,
  },
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  radiusBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: C.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radiusBtnText: {
    fontSize: 22,
    fontWeight: '600',
    color: C.gray700,
  },
  radiusDisplay: {
    alignItems: 'center',
  },
  radiusValue: {
    fontSize: 28,
    fontWeight: '700',
    color: C.gray900,
  },
  radiusUnit: {
    fontSize: 13,
    color: C.gray500,
  },
  homeContent: {
    padding: 16,
  },
  resultCount: {
    fontSize: 14,
    color: C.gray600,
    marginBottom: 12,
  },

  // ── Parking Card ──────────────────────────────────
  card: {
    backgroundColor: C.white,
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  cardImageWrap: {
    height: 180,
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardFavBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  cardPriceBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: C.white,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  cardPriceText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.gray900,
  },
  cardBody: {
    padding: 16,
  },
  cardName: {
    fontSize: 17,
    fontWeight: '700',
    color: C.gray900,
    marginBottom: 4,
  },
  cardAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  cardAddress: {
    fontSize: 13,
    color: C.gray600,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardRatingNum: {
    fontSize: 14,
    fontWeight: '600',
    color: C.gray900,
  },
  cardReviews: {
    fontSize: 13,
    color: C.gray500,
  },
  cardAvail: {
    fontSize: 13,
    fontWeight: '500',
  },
  cardAvailLow: {
    color: C.red600,
  },
  cardAvailOk: {
    color: C.green600,
  },
  cardFeatures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  featureChip: {
    backgroundColor: C.gray100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  featureChipText: {
    fontSize: 12,
    color: C.gray700,
  },

  // ── Map View Placeholder ──────────────────────────
  mapPlaceholder: {
    backgroundColor: C.white,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  mapPlaceholderInner: {
    height: 220,
    backgroundColor: C.blue50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  mapPlaceholderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.gray900,
    marginTop: 12,
  },
  mapPlaceholderSub: {
    fontSize: 14,
    color: C.gray600,
    marginTop: 4,
  },
  mapPlaceholderCount: {
    fontSize: 13,
    color: C.gray500,
    marginTop: 8,
  },
  mapSpotItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: C.gray200,
    borderRadius: 10,
    marginBottom: 8,
  },
  mapSpotInfo: {},
  mapSpotName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.gray900,
  },
  mapSpotDist: {
    fontSize: 13,
    color: C.gray600,
    marginTop: 2,
  },
  mapSpotPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: C.blue600,
  },

  // ── Shared Screen Header ──────────────────────────
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.white,
    paddingHorizontal: 12,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  backBtn: {
    padding: 8,
    borderRadius: 20,
  },
  screenHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.gray900,
  },

  // ── Detail Screen ─────────────────────────────────
  detailImageWrap: {
    height: 240,
    position: 'relative',
  },
  detailImage: {
    width: '100%',
    height: '100%',
  },
  detailFavBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  detailSection: {
    backgroundColor: C.white,
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 16,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  detailTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  detailName: {
    fontSize: 22,
    fontWeight: '700',
    color: C.gray900,
    marginBottom: 6,
  },
  detailAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailAddress: {
    fontSize: 14,
    color: C.gray600,
  },
  detailPriceBox: {
    alignItems: 'flex-end',
  },
  detailPrice: {
    fontSize: 28,
    fontWeight: '700',
    color: C.blue600,
  },
  detailPriceUnit: {
    fontSize: 13,
    color: C.gray600,
  },
  detailStatsRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 16,
  },
  detailStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailStatBold: {
    fontSize: 15,
    fontWeight: '600',
    color: C.gray900,
  },
  detailStatLight: {
    fontSize: 14,
    color: C.gray600,
  },
  detailAvailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  detailAvailBadgeOk: {
    backgroundColor: C.green50,
  },
  detailAvailBadgeLow: {
    backgroundColor: C.red50,
  },
  detailAvailText: {
    fontSize: 14,
    fontWeight: '500',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  featureText: {
    fontSize: 15,
    color: C.gray700,
  },

  // ── Fixed Bottom Button ───────────────────────────
  fixedBottomBtn: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.white,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  bookBtn: {
    backgroundColor: C.blue600,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: C.blue700,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  bookBtnText: {
    color: C.white,
    fontSize: 18,
    fontWeight: '700',
  },

  // ── Booking Screen ────────────────────────────────
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 16,
    backgroundColor: C.white,
  },
  progressDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotActive: {
    backgroundColor: C.blue600,
  },
  progressDotInactive: {
    backgroundColor: C.gray200,
  },
  progressDotText: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressDotTextActive: {
    color: C.white,
  },
  progressDotTextInactive: {
    color: C.gray600,
  },
  progressLine: {
    flex: 1,
    height: 3,
    marginHorizontal: 6,
    borderRadius: 2,
  },
  progressLineActive: {
    backgroundColor: C.blue600,
  },
  progressLineInactive: {
    backgroundColor: C.gray200,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 12,
    backgroundColor: C.white,
  },
  progressLabel: {
    fontSize: 12,
    color: C.gray500,
  },
  bookingContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionCard: {
    backgroundColor: C.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.gray900,
    marginBottom: 14,
  },
  dateRow: {
    gap: 10,
    paddingVertical: 4,
  },
  dateChip: {
    width: 72,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.gray200,
    alignItems: 'center',
  },
  dateChipSelected: {
    borderColor: C.blue600,
    backgroundColor: C.blue600,
  },
  dateChipDay: {
    fontSize: 12,
    fontWeight: '500',
    color: C.gray500,
    marginBottom: 4,
  },
  dateChipDate: {
    fontSize: 22,
    fontWeight: '700',
    color: C.gray900,
  },
  dateChipMonth: {
    fontSize: 12,
    color: C.gray500,
    marginTop: 2,
  },
  dateChipTextSelected: {
    color: C.white,
  },
  timeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.gray200,
    backgroundColor: C.white,
  },
  timeChipSelected: {
    borderColor: C.blue600,
    backgroundColor: C.blue600,
  },
  timeChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: C.gray700,
  },
  timeChipTextSelected: {
    color: C.white,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  durationBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBtnText: {
    fontSize: 24,
    fontWeight: '600',
    color: C.gray700,
  },
  durationDisplay: {
    alignItems: 'center',
    minWidth: 80,
  },
  durationValue: {
    fontSize: 36,
    fontWeight: '700',
    color: C.gray900,
  },
  durationUnit: {
    fontSize: 14,
    color: C.gray600,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  priceLabel: {
    fontSize: 15,
    color: C.gray600,
  },
  priceValue2: {
    fontSize: 15,
    fontWeight: '600',
    color: C.gray900,
  },
  priceDivider: {
    height: 1,
    backgroundColor: C.gray200,
    marginVertical: 10,
  },
  priceTotalLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: C.gray900,
  },
  priceTotalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: C.blue600,
  },
  primaryBtn: {
    backgroundColor: C.blue600,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    color: C.white,
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.gray300,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 12,
  },
  secondaryBtnText: {
    color: C.gray700,
    fontSize: 16,
    fontWeight: '600',
  },

  // ── Payment ───────────────────────────────────────
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: C.gray200,
    borderRadius: 12,
    marginBottom: 10,
  },
  paymentOptionSelected: {
    borderColor: C.blue600,
    backgroundColor: C.blue50,
  },
  paymentOptionText: {
    fontSize: 16,
    fontWeight: '500',
    color: C.gray900,
  },

  // ── Booking Summary ───────────────────────────────
  summaryLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: C.gray500,
    marginBottom: 4,
    marginTop: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '600',
    color: C.gray900,
  },
  summarySubValue: {
    fontSize: 14,
    color: C.gray600,
    marginTop: 2,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: C.gray200,
    marginVertical: 14,
  },
  infoBox: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: C.blue50,
    borderWidth: 1,
    borderColor: C.blue100,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  infoBoxContent: {
    flex: 1,
  },
  infoBoxTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.blue900,
    marginBottom: 4,
  },
  infoBoxText: {
    fontSize: 14,
    color: C.blue900,
    lineHeight: 20,
  },

  // ── Receipt ───────────────────────────────────────
  receiptHeader: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  receiptCheckCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  receiptTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: C.white,
    marginBottom: 4,
  },
  receiptSubtitle: {
    fontSize: 15,
    color: '#bbf7d0',
  },
  receiptBody: {
    backgroundColor: C.white,
    marginHorizontal: 16,
    marginTop: -16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  receiptRow: {
    marginBottom: 4,
  },
  receiptLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.gray500,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  receiptId: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: C.gray900,
  },
  receiptValue: {
    fontSize: 16,
    fontWeight: '600',
    color: C.gray900,
  },
  receiptSubValue: {
    fontSize: 14,
    color: C.gray600,
    marginTop: 2,
  },
  receiptIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: C.gray200,
    marginVertical: 14,
  },
  receiptInfoBox: {
    backgroundColor: C.gray50,
    borderRadius: 10,
    padding: 16,
    marginTop: 12,
  },
  receiptInfoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.gray700,
    marginBottom: 8,
  },
  receiptInfoItem: {
    fontSize: 14,
    color: C.gray700,
    lineHeight: 22,
  },
  receiptActions: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },

  // ── Profile ───────────────────────────────────────
  profileContent: {
    padding: 16,
  },
  profileCard: {
    backgroundColor: C.white,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  profileAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.blue600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '700',
    color: C.gray900,
  },
  profileEmail: {
    fontSize: 15,
    color: C.gray600,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: C.white,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  statNumber: {
    fontSize: 28,
    fontWeight: '700',
    color: C.blue600,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: C.gray600,
  },
  bookingItem: {
    backgroundColor: C.gray50,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  bookingItemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  bookingItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.gray900,
    flex: 1,
  },
  bookingItemPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: C.green600,
  },
  bookingItemDate: {
    fontSize: 13,
    color: C.gray600,
  },
  bookingItemId: {
    fontSize: 12,
    color: C.gray500,
    marginTop: 4,
  },
  favItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.gray50,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  favItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.gray900,
  },
  favItemAddress: {
    fontSize: 13,
    color: C.gray600,
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: C.gray500,
    fontSize: 15,
    paddingVertical: 32,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.red600,
    borderRadius: 14,
    paddingVertical: 18,
    marginTop: 8,
  },
  logoutBtnText: {
    color: C.white,
    fontSize: 17,
    fontWeight: '700',
  },
});
