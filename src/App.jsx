import React, { useState, useEffect, createContext, useContext } from 'react';
import { MapPin, Search, Filter, Star, Clock, DollarSign, CreditCard, User, LogOut, ChevronLeft, ChevronRight, Calendar, Navigation, Wifi, WifiOff, Heart, X, Check, Info } from 'lucide-react';

// Context for global state management
const AppContext = createContext();

const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};

// Mock parking data
const mockParkingSpots = [
  {
    id: 1,
    name: "Downtown Plaza Parking",
    address: "123 Main St, Downtown",
    price: 8,
    type: "paid",
    rating: 4.5,
    reviews: 127,
    distance: 0.3,
    availability: 15,
    totalSpots: 50,
    features: ["Covered", "EV Charging", "24/7 Access"],
    lat: 40.7580,
    lng: -73.9855,
    image: "https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=400&h=300&fit=crop"
  },
  {
    id: 2,
    name: "City Center Garage",
    address: "456 Oak Ave, Midtown",
    price: 12,
    type: "paid",
    rating: 4.2,
    reviews: 89,
    distance: 0.5,
    availability: 8,
    totalSpots: 100,
    features: ["Indoor", "Security", "Valet"],
    lat: 40.7589,
    lng: -73.9851,
    image: "https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=400&h=300&fit=crop"
  },
  {
    id: 3,
    name: "Street Parking - 5th Ave",
    address: "5th Avenue, Zone A",
    price: 0,
    type: "free",
    rating: 3.8,
    reviews: 45,
    distance: 0.2,
    availability: 3,
    totalSpots: 20,
    features: ["Street Level", "2hr Limit"],
    lat: 40.7590,
    lng: -73.9845,
    image: "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=400&h=300&fit=crop"
  },
  {
    id: 4,
    name: "Riverside Parking Lot",
    address: "789 River Rd, Westside",
    price: 6,
    type: "paid",
    rating: 4.7,
    reviews: 203,
    distance: 0.8,
    availability: 25,
    totalSpots: 75,
    features: ["Outdoor", "Well-lit", "CCTV"],
    lat: 40.7595,
    lng: -73.9870,
    image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop"
  },
  {
    id: 5,
    name: "Metro Station Parking",
    address: "321 Transit Blvd, Station District",
    price: 10,
    type: "paid",
    rating: 4.0,
    reviews: 156,
    distance: 1.2,
    availability: 40,
    totalSpots: 200,
    features: ["Multi-level", "Shuttle Service", "Monthly Pass"],
    lat: 40.7570,
    lng: -73.9840,
    image: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&h=300&fit=crop"
  },
  {
    id: 6,
    name: "Park & Walk - Elm Street",
    address: "Elm Street, Historic Quarter",
    price: 0,
    type: "free",
    rating: 3.5,
    reviews: 32,
    distance: 0.6,
    availability: 5,
    totalSpots: 15,
    features: ["Street Parking", "No Time Limit"],
    lat: 40.7585,
    lng: -73.9860,
    image: "https://images.unsplash.com/photo-1519125323398-675f0ddb6308?w=400&h=300&fit=crop"
  }
];

// App Provider Component
const AppProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [currentScreen, setCurrentScreen] = useState('login');
  const [favorites, setFavorites] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [isOnline, setIsOnline] = useState(true);
  const [selectedParking, setSelectedParking] = useState(null);
  const [bookingData, setBookingData] = useState(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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
    setFavorites(prev =>
      prev.includes(parkingId)
        ? prev.filter(id => id !== parkingId)
        : [...prev, parkingId]
    );
  };

  const addBooking = (booking) => {
    setBookings(prev => [...prev, { ...booking, id: Date.now() }]);
  };

  return (
    <AppContext.Provider value={{
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
      setBookingData
    }}>
      {children}
    </AppContext.Provider>
  );
};

// Login Screen Component
const LoginScreen = () => {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    setTimeout(() => {
      if (login(email, password)) {
        setLoading(false);
      } else {
        setError('Invalid email or password');
        setLoading(false);
      }
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
            <MapPin className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">ParkFinder</h1>
          <p className="text-gray-600">Find parking spots near you</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="Enter your password"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <div className="text-center text-sm text-gray-600">
            Demo: Use any email and password to login
          </div>
        </form>
      </div>
    </div>
  );
};

// Home Screen Component
const HomeScreen = () => {
  const { setCurrentScreen, setSelectedParking, favorites, isOnline } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterRadius, setFilterRadius] = useState(5);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState('list');

  const filteredSpots = mockParkingSpots.filter(spot => {
    const matchesSearch = spot.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
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
    <div className="min-h-screen bg-gray-50">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-yellow-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4" />
          You are offline. Showing cached results.
        </div>
      )}

      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <MapPin className="w-6 h-6 text-blue-600" />
              ParkFinder
            </h1>
            <button
              onClick={() => setCurrentScreen('profile')}
              className="p-2 hover:bg-gray-100 rounded-full transition"
            >
              <User className="w-6 h-6 text-gray-600" />
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search parking spots..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>

          {/* Filter and View Mode Buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
            >
              <Filter className="w-4 h-4" />
              Filters
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <MapPin className="w-4 h-4" />
              {viewMode === 'list' ? 'Map View' : 'List View'}
            </button>
          </div>

          {/* Filters Panel */}
          {showFilters && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Parking Type
                </label>
                <div className="flex gap-2">
                  {['all', 'free', 'paid'].map(type => (
                    <button
                      key={type}
                      onClick={() => setFilterType(type)}
                      className={`px-4 py-2 rounded-lg font-medium transition ${
                        filterType === type
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Radius: {filterRadius} miles
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={filterRadius}
                  onChange={(e) => setFilterRadius(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {viewMode === 'list' ? (
          <>
            <div className="mb-4 text-sm text-gray-600">
              {filteredSpots.length} parking spots found
            </div>

            <div className="space-y-4">
              {filteredSpots.map(spot => (
                <ParkingCard
                  key={spot.id}
                  spot={spot}
                  isFavorite={favorites.includes(spot.id)}
                  onClick={() => handleSelectParking(spot)}
                />
              ))}
            </div>
          </>
        ) : (
          <MapView spots={filteredSpots} onSelectSpot={handleSelectParking} />
        )}
      </div>
    </div>
  );
};

// Parking Card Component
const ParkingCard = ({ spot, isFavorite, onClick }) => {
  const { toggleFavorite } = useApp();

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl shadow-sm hover:shadow-md transition cursor-pointer overflow-hidden"
    >
      <div className="relative h-48">
        <img
          src={spot.image}
          alt={spot.name}
          className="w-full h-full object-cover"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(spot.id);
          }}
          className="absolute top-3 right-3 p-2 bg-white rounded-full shadow-lg hover:scale-110 transition"
        >
          <Heart
            className={`w-5 h-5 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-400'}`}
          />
        </button>
        <div className="absolute bottom-3 left-3 bg-white px-3 py-1 rounded-full text-sm font-semibold">
          {spot.type === 'free' ? 'FREE' : `$${spot.price}/hr`}
        </div>
      </div>

      <div className="p-4">
        <h3 className="font-bold text-lg text-gray-900 mb-1">{spot.name}</h3>
        <p className="text-sm text-gray-600 mb-3 flex items-center gap-1">
          <MapPin className="w-4 h-4" />
          {spot.address} · {spot.distance} mi
        </p>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              <span className="font-semibold">{spot.rating}</span>
              <span className="text-sm text-gray-500">({spot.reviews})</span>
            </div>
          </div>
          <div className={`text-sm font-medium ${spot.availability < 5 ? 'text-red-600' : 'text-green-600'}`}>
            {spot.availability} spots available
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {spot.features.slice(0, 3).map((feature, idx) => (
            <span key={idx} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
              {feature}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

// Map View Component
const MapView = ({ spots, onSelectSpot }) => {
  return (
    <div className="bg-white rounded-xl shadow-sm p-8 text-center">
      <div className="w-full h-96 bg-gradient-to-br from-blue-100 to-blue-200 rounded-lg flex items-center justify-center mb-6">
        <div className="text-center">
          <MapPin className="w-16 h-16 text-blue-600 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Interactive Map View</h3>
          <p className="text-gray-600 mb-4">Map functionality would be displayed here</p>
          <div className="text-sm text-gray-500">
            Showing {spots.length} parking locations
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {spots.map(spot => (
          <div
            key={spot.id}
            onClick={() => onSelectSpot(spot)}
            className="p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition cursor-pointer"
          >
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-semibold text-gray-900">{spot.name}</h4>
              <span className="text-blue-600 font-bold">
                {spot.type === 'free' ? 'FREE' : `$${spot.price}`}
              </span>
            </div>
            <p className="text-sm text-gray-600">{spot.distance} mi away</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// Detail Screen Component
const DetailScreen = () => {
  const { selectedParking, setCurrentScreen, favorites, toggleFavorite, setBookingData } = useApp();

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
      paymentMethod: null
    });
    setCurrentScreen('booking');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setCurrentScreen('home')}
            className="p-2 hover:bg-gray-100 rounded-full transition"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">Parking Details</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Image */}
        <div className="relative h-64 rounded-xl overflow-hidden mb-6">
          <img
            src={selectedParking.image}
            alt={selectedParking.name}
            className="w-full h-full object-cover"
          />
          <button
            onClick={() => toggleFavorite(selectedParking.id)}
            className="absolute top-4 right-4 p-3 bg-white rounded-full shadow-lg hover:scale-110 transition"
          >
            <Heart
              className={`w-6 h-6 ${favorites.includes(selectedParking.id) ? 'fill-red-500 text-red-500' : 'text-gray-400'}`}
            />
          </button>
        </div>

        {/* Main Info */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {selectedParking.name}
              </h2>
              <p className="text-gray-600 flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                {selectedParking.address}
              </p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-blue-600">
                {selectedParking.type === 'free' ? 'FREE' : `$${selectedParking.price}`}
              </div>
              {selectedParking.type !== 'free' && (
                <div className="text-sm text-gray-600">per hour</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-6 mb-4">
            <div className="flex items-center gap-1">
              <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
              <span className="font-semibold">{selectedParking.rating}</span>
              <span className="text-gray-600">({selectedParking.reviews} reviews)</span>
            </div>
            <div className="flex items-center gap-1 text-gray-600">
              <Navigation className="w-5 h-5" />
              {selectedParking.distance} mi away
            </div>
          </div>

          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${
            selectedParking.availability < 5
              ? 'bg-red-50 text-red-700'
              : 'bg-green-50 text-green-700'
          }`}>
            <Info className="w-5 h-5" />
            <span className="font-medium">
              {selectedParking.availability} of {selectedParking.totalSpots} spots available
            </span>
          </div>
        </div>

        {/* Features */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Features & Amenities</h3>
          <div className="grid grid-cols-2 gap-3">
            {selectedParking.features.map((feature, idx) => (
              <div key={idx} className="flex items-center gap-2 text-gray-700">
                <Check className="w-5 h-5 text-green-600" />
                {feature}
              </div>
            ))}
          </div>
        </div>

        {/* Book Now Button */}
        <button
          onClick={handleBookNow}
          className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition shadow-lg"
        >
          Book This Spot
        </button>
      </div>
    </div>
  );
};

// Booking Screen Component
const BookingScreen = () => {
  const { bookingData, setBookingData, setCurrentScreen, addBooking } = useApp();
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [duration, setDuration] = useState(2);
  const [paymentMethod, setPaymentMethod] = useState('');

  if (!bookingData) {
    setCurrentScreen('home');
    return null;
  }

  const totalPrice = bookingData.parking.type === 'free' ? 0 : bookingData.parking.price * duration;
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
      bookingDate: new Date().toISOString()
    };
    addBooking(booking);
    setCurrentScreen('receipt');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => step > 1 ? setStep(step - 1) : setCurrentScreen('detail')}
              className="p-2 hover:bg-gray-100 rounded-full transition"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <h1 className="text-xl font-bold text-gray-900">Book Parking</h1>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-between">
            {[1, 2, 3].map(num => (
              <div key={num} className="flex items-center flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                  step >= num ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                }`}>
                  {num}
                </div>
                {num < 3 && (
                  <div className={`flex-1 h-1 mx-2 ${
                    step > num ? 'bg-blue-600' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-between mt-2 text-xs text-gray-600">
            <span>Date & Time</span>
            <span>Payment</span>
            <span>Confirm</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Step 1: Date & Time */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Select Date</h3>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Select Time</h3>
              <input
                type="time"
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Duration</h3>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setDuration(Math.max(1, duration - 1))}
                  className="w-12 h-12 bg-gray-100 rounded-lg hover:bg-gray-200 transition font-bold text-xl"
                >
                  -
                </button>
                <div className="flex-1 text-center">
                  <div className="text-3xl font-bold text-gray-900">{duration}</div>
                  <div className="text-sm text-gray-600">hour{duration !== 1 ? 's' : ''}</div>
                </div>
                <button
                  onClick={() => setDuration(Math.min(24, duration + 1))}
                  className="w-12 h-12 bg-gray-100 rounded-lg hover:bg-gray-200 transition font-bold text-xl"
                >
                  +
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-700">Parking Rate</span>
                <span className="font-semibold">
                  {bookingData.parking.type === 'free' ? 'FREE' : `$${bookingData.parking.price}/hr`}
                </span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-700">Duration</span>
                <span className="font-semibold">{duration} hour{duration !== 1 ? 's' : ''}</span>
              </div>
              <div className="border-t pt-2 mt-2">
                <div className="flex items-center justify-between text-lg font-bold">
                  <span>Subtotal</span>
                  <span className="text-blue-600">${totalPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleNext}
              disabled={!selectedDate || !selectedTime}
              className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue to Payment
            </button>
          </div>
        )}

        {/* Step 2: Payment */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Select Payment Method</h3>
              <div className="space-y-3">
                {[
                  { id: 'card', name: 'Credit/Debit Card', icon: CreditCard },
                  { id: 'apple', name: 'Apple Pay', icon: DollarSign },
                  { id: 'google', name: 'Google Pay', icon: DollarSign }
                ].map(method => (
                  <button
                    key={method.id}
                    onClick={() => setPaymentMethod(method.id)}
                    className={`w-full p-4 border-2 rounded-lg flex items-center gap-3 transition ${
                      paymentMethod === method.id
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <method.icon className="w-6 h-6 text-gray-700" />
                    <span className="font-medium text-gray-900">{method.name}</span>
                    {paymentMethod === method.id && (
                      <Check className="w-6 h-6 text-blue-600 ml-auto" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Price Breakdown</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">Parking ({duration}hr)</span>
                  <span className="font-semibold">${totalPrice.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">Service Fee (10%)</span>
                  <span className="font-semibold">${commission.toFixed(2)}</span>
                </div>
                <div className="border-t pt-2 mt-2">
                  <div className="flex items-center justify-between text-xl font-bold">
                    <span>Total</span>
                    <span className="text-blue-600">${finalPrice.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handleNext}
              disabled={!paymentMethod}
              className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Review Booking
            </button>
          </div>
        )}

        {/* Step 3: Confirmation */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Booking Summary</h3>

              <div className="space-y-4">
                <div>
                  <div className="text-sm text-gray-600 mb-1">Location</div>
                  <div className="font-semibold text-gray-900">{bookingData.parking.name}</div>
                  <div className="text-sm text-gray-600">{bookingData.parking.address}</div>
                </div>

                <div className="border-t pt-4">
                  <div className="text-sm text-gray-600 mb-1">Date & Time</div>
                  <div className="font-semibold text-gray-900">
                    {new Date(selectedDate).toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </div>
                  <div className="text-sm text-gray-600">
                    {selectedTime} · {duration} hour{duration !== 1 ? 's' : ''}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="text-sm text-gray-600 mb-1">Payment Method</div>
                  <div className="font-semibold text-gray-900 capitalize">{paymentMethod}</div>
                </div>

                <div className="border-t pt-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Parking Fee</span>
                      <span className="font-semibold">${totalPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Service Fee (10%)</span>
                      <span className="font-semibold">${commission.toFixed(2)}</span>
                    </div>
                    <div className="border-t pt-2">
                      <div className="flex items-center justify-between text-lg font-bold">
                        <span>Total Amount</span>
                        <span className="text-blue-600">${finalPrice.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex gap-3">
                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900">
                  <div className="font-semibold mb-1">Cancellation Policy</div>
                  <div>Free cancellation up to 1 hour before your booking starts.</div>
                </div>
              </div>
            </div>

            <button
              onClick={handleConfirm}
              className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition"
            >
              Confirm & Pay ${finalPrice.toFixed(2)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Receipt Screen Component
const ReceiptScreen = () => {
  const { bookings, setCurrentScreen } = useApp();
  const latestBooking = bookings[bookings.length - 1];

  if (!latestBooking) {
    setCurrentScreen('home');
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Success Header */}
          <div className="bg-gradient-to-r from-green-500 to-green-600 p-8 text-center text-white">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Booking Confirmed!</h2>
            <p className="text-green-100">Your parking spot has been reserved</p>
          </div>

          {/* Receipt Details */}
          <div className="p-6 space-y-6">
            <div>
              <h3 className="text-sm font-medium text-gray-600 mb-2">BOOKING ID</h3>
              <p className="text-lg font-mono font-semibold text-gray-900">
                #{latestBooking.id}
              </p>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-600 mb-2">LOCATION</h3>
              <p className="font-semibold text-gray-900">{latestBooking.parking.name}</p>
              <p className="text-sm text-gray-600">{latestBooking.parking.address}</p>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-600 mb-2">DATE & TIME</h3>
              <div className="flex items-center gap-2 text-gray-900">
                <Calendar className="w-5 h-5 text-gray-600" />
                <span className="font-semibold">
                  {new Date(latestBooking.date).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2 text-gray-900 mt-2">
                <Clock className="w-5 h-5 text-gray-600" />
                <span className="font-semibold">
                  {latestBooking.time} · {latestBooking.duration} hour{latestBooking.duration !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-600 mb-3">PAYMENT DETAILS</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">Parking Fee</span>
                  <span className="font-semibold">
                    ${(latestBooking.totalPrice - latestBooking.commission).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">Service Fee (10%)</span>
                  <span className="font-semibold">${latestBooking.commission.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>Payment Method</span>
                  <span className="capitalize">{latestBooking.paymentMethod}</span>
                </div>
                <div className="border-t pt-2 mt-2">
                  <div className="flex items-center justify-between text-lg font-bold">
                    <span>Total Paid</span>
                    <span className="text-green-600">${latestBooking.totalPrice.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700">
              <div className="font-medium mb-2">Important Information:</div>
              <ul className="space-y-1 list-disc list-inside">
                <li>Please arrive on time for your reservation</li>
                <li>Present this booking ID at the parking entrance</li>
                <li>Free cancellation up to 1 hour before start time</li>
              </ul>
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 bg-gray-50 space-y-3">
            <button
              onClick={() => setCurrentScreen('home')}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              Done
            </button>
            <button
              onClick={() => window.print()}
              className="w-full bg-white border border-gray-300 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-50 transition"
            >
              Print Receipt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Profile Screen Component
const ProfileScreen = () => {
  const { user, logout, setCurrentScreen, bookings, favorites } = useApp();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setCurrentScreen('home')}
            className="p-2 hover:bg-gray-100 rounded-full transition"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">Profile</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* User Info */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center">
              <User className="w-10 h-10 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{user?.name}</h2>
              <p className="text-gray-600">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <div className="text-3xl font-bold text-blue-600 mb-1">{bookings.length}</div>
            <div className="text-sm text-gray-600">Total Bookings</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <div className="text-3xl font-bold text-blue-600 mb-1">{favorites.length}</div>
            <div className="text-sm text-gray-600">Favorites</div>
          </div>
        </div>

        {/* Recent Bookings */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Recent Bookings</h3>
          {bookings.length > 0 ? (
            <div className="space-y-3">
              {bookings.slice(-5).reverse().map((booking) => (
                <div key={booking.id} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-semibold text-gray-900">{booking.parking.name}</div>
                    <div className="text-sm font-semibold text-green-600">
                      ${booking.totalPrice.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    {new Date(booking.date).toLocaleDateString()} · {booking.time}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Booking ID: #{booking.id}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600 text-center py-8">No bookings yet</p>
          )}
        </div>

        {/* Favorites */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Favorite Spots</h3>
          {favorites.length > 0 ? (
            <div className="space-y-3">
              {favorites.map(id => {
                const spot = mockParkingSpots.find(s => s.id === id);
                return spot ? (
                  <div key={id} className="p-4 bg-gray-50 rounded-lg flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-gray-900">{spot.name}</div>
                      <div className="text-sm text-gray-600">{spot.address}</div>
                    </div>
                    <Heart className="w-5 h-5 fill-red-500 text-red-500" />
                  </div>
                ) : null;
              })}
            </div>
          ) : (
            <p className="text-gray-600 text-center py-8">No favorites yet</p>
          )}
        </div>

        {/* Logout Button */}
        <button
          onClick={logout}
          className="w-full bg-red-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-700 transition flex items-center justify-center gap-2"
        >
          <LogOut className="w-5 h-5" />
          Logout
        </button>
      </div>
    </div>
  );
};

// Main App Component
const ParkingFinderApp = () => {
  const { currentScreen } = useApp();

  return (
    <div className="font-sans antialiased">
      {currentScreen === 'login' && <LoginScreen />}
      {currentScreen === 'home' && <HomeScreen />}
      {currentScreen === 'detail' && <DetailScreen />}
      {currentScreen === 'booking' && <BookingScreen />}
      {currentScreen === 'receipt' && <ReceiptScreen />}
      {currentScreen === 'profile' && <ProfileScreen />}
    </div>
  );
};

// Export wrapped with provider
export default function App() {
  return (
    <AppProvider>
      <ParkingFinderApp />
    </AppProvider>
  );
}
