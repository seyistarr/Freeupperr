// listings.js
// Complete marketplace API for Freeupper.
// Uses Supabase RPC for views, secure auth for user IDs, unified reports, realtime, and Cloudinary uploads.
// All methods are under the ListingsAPI namespace.

(function() {
    'use strict';

    // ──────────────────────────────────────────────
    //  CONFIG
    // ──────────────────────────────────────────────
    const CLOUDINARY_CLOUD_NAME = 'duzyf1kda'; // replace with your cloud name
    const CLOUDINARY_UPLOAD_PRESET = 'market_upload'; // your upload preset

    // ──────────────────────────────────────────────
    //  CATEGORY CACHE (simple in-memory)
    // ──────────────────────────────────────────────
    let _categories = []; // array of category objects
    let _subcategories = {}; // { categoryId: [sub] }

    // ──────────────────────────────────────────────
    //  AUTH HELPER – get the current user ID
    // ──────────────────────────────────────────────
    async function _getUserId() {
        const { data: { user }, error } = await window.sb.auth.getUser();
        if (error || !user) throw new Error('You must be logged in to perform this action.');
        return user.id;
    }

    // ──────────────────────────────────────────────
    //  CATEGORY & SUBCATEGORY METHODS
    // ──────────────────────────────────────────────

    /**
     * Load all active categories (cached).
     */
    async function loadCategories(force = false) {
        if (_categories.length && !force) return _categories;
        const { data, error } = await window.sb
            .from('market_categories')
            .select('*')
            .eq('active', true)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        _categories = data || [];
        return _categories;
    }

    /**
     * Load subcategories for a category (cached per category).
     */
    async function loadSubcategories(categoryId, force = false) {
        if (!categoryId) return [];
        if (_subcategories[categoryId] && !force) return _subcategories[categoryId];
        const { data, error } = await window.sb
            .from('market_subcategories')
            .select('*')
            .eq('category_id', categoryId)
            .eq('active', true)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        _subcategories[categoryId] = data || [];
        return _subcategories[categoryId];
    }

    /**
     * Get a single category by ID.
     */
    async function getCategory(categoryId) {
        const cats = await loadCategories();
        return cats.find(c => c.id === categoryId) || null;
    }

    /**
     * Get a single subcategory by ID.
     */
    async function getSubcategory(subcategoryId) {
        if (!subcategoryId) return null;
        const { data, error } = await window.sb
            .from('market_subcategories')
            .select('*')
            .eq('id', subcategoryId)
            .single();
        if (error) return null;
        return data;
    }

    // ──────────────────────────────────────────────
    //  IMAGE UPLOAD HELPER (Cloudinary)
    // ──────────────────────────────────────────────

    /**
     * Upload one or more image files to Cloudinary.
     * Returns an array of { url, public_id }.
     */
    async function uploadImages(files) {
        if (!files || files.length === 0) return [];
        const results = [];
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                throw new Error(`File "${file.name}" is not an image.`);
            }
            const formData = new FormData();
            formData.append('file', file);
            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
            const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
            const res = await fetch(url, { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error?.message || `Upload failed for ${file.name}`);
            }
            results.push({ url: data.secure_url, public_id: data.public_id });
        }
        return results;
    }

    // ──────────────────────────────────────────────
    //  REAL-TIME SUBSCRIPTION
    // ──────────────────────────────────────────────

    let _realtimeChannel = null;
    let _realtimeCallbacks = [];

    /**
     * Subscribe to real-time changes on market_listings.
     * @param {Function} callback - function(payload) called on any change
     * @returns {void}
     */
    function subscribe(callback) {
        if (typeof callback === 'function') {
            _realtimeCallbacks.push(callback);
        }
        if (_realtimeChannel) return; // already subscribed

        _realtimeChannel = window.sb
            .channel('market_listings_changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'market_listings'
                },
                (payload) => {
                    // Notify all registered callbacks
                    _realtimeCallbacks.forEach(fn => {
                        try { fn(payload); } catch (e) { console.warn('Realtime callback error:', e); }
                    });
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('✅ Subscribed to market_listings realtime');
                }
            });
    }

    /**
     * Unsubscribe from real-time changes.
     */
    function unsubscribe() {
        if (_realtimeChannel) {
            window.sb.removeChannel(_realtimeChannel);
            _realtimeChannel = null;
            _realtimeCallbacks = [];
        }
    }

    // ──────────────────────────────────────────────
    //  LISTINGS CRUD (ALL USER IDs FROM AUTH)
    // ──────────────────────────────────────────────

    const ListingsAPI = {

        // ─── Category helpers ───
        loadCategories,
        loadSubcategories,
        getCategory,
        getSubcategory,

        // ─── Image upload ───
        uploadImages,

        // ─── Realtime ───
        subscribe,
        unsubscribe,

        // ─── Create Listing ───
        async createListing(data) {
            // Get authenticated user ID – never trust frontend
            const userId = await _getUserId();

            if (!data.title?.trim()) throw new Error('Title is required');
            if (!data.price || data.price <= 0) throw new Error('Valid price is required');
            if (!data.category_id) throw new Error('Category is required');

            // Validate subcategory belongs to category
            if (data.subcategory_id) {
                const sub = await getSubcategory(data.subcategory_id);
                if (!sub) throw new Error('Invalid subcategory');
                if (sub.category_id !== data.category_id) {
                    throw new Error('Subcategory does not belong to selected category');
                }
            }

            // Ensure images are uploaded; if not, we accept them as is (the caller should have used uploadImages)
            const images = data.images || [];
            const payload = {
                seller_id: userId,
                title: data.title.trim(),
                price: data.price,
                category_id: data.category_id,
                subcategory_id: data.subcategory_id || null,
                location: data.location || 'Campus',
                lat: data.lat || null,
                lng: data.lng || null,
                images: images,
                description: data.description || '',
                condition: data.condition || 'New',
                status: 'active'
            };

            const { data: inserted, error } = await window.sb
                .from('market_listings')
                .insert(payload)
                .select()
                .single();
            if (error) throw error;
            return inserted;
        },

        // ─── Get single listing ───
        async getListing(listingId) {
            const { data, error } = await window.sb
                .from('market_listings')
                .select(`
                    *,
                    profiles:seller_id (display_name, avatar_url, verified),
                    market_categories (name),
                    market_subcategories (name)
                `)
                .eq('id', listingId)
                .single();
            if (error) throw error;
            return data;
        },

        // ─── Get listings (filtered, paginated, search) ───
        async getListings(filters = {}) {
            let query = window.sb
                .from('market_listings')
                .select(`
                    *,
                    profiles:seller_id (display_name, avatar_url, verified),
                    market_categories (name),
                    market_subcategories (name)
                `, { count: 'exact' });

            // Filters
            if (filters.category_id) query = query.eq('category_id', filters.category_id);
            if (filters.subcategory_id) query = query.eq('subcategory_id', filters.subcategory_id);
            if (filters.seller_id) query = query.eq('seller_id', filters.seller_id);
            // Default status: active
            const status = filters.status || 'active';
            query = query.eq('status', status);

            // Search in title and description
            if (filters.search) {
                query = query.or(
                    `title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`
                );
            }

            // Order
            const orderBy = filters.order_by || 'created_at';
            const orderDir = filters.order_dir || 'desc';
            query = query.order(orderBy, { ascending: orderDir === 'asc' });

            // Pagination: use range only
            const limit = filters.limit || 20;
            const offset = filters.offset || 0;
            query = query.range(offset, offset + limit - 1);

            const { data, error, count } = await query;
            if (error) throw error;
            return { data, count };
        },

        // ─── Update listing ───
        async updateListing(listingId, updates) {
            // Only the seller or admin should be allowed; we don't check here to keep it flexible,
            // but your RLS policy should enforce that.
            const allowed = ['title', 'price', 'description', 'location', 'lat', 'lng', 'images', 'condition', 'category_id', 'subcategory_id', 'status'];
            const payload = {};
            for (const key of allowed) {
                if (updates.hasOwnProperty(key)) {
                    payload[key] = updates[key];
                }
            }
            // Validate subcategory if provided
            if (payload.subcategory_id && payload.category_id) {
                const sub = await getSubcategory(payload.subcategory_id);
                if (!sub) throw new Error('Invalid subcategory');
                if (sub.category_id !== payload.category_id) {
                    throw new Error('Subcategory does not belong to selected category');
                }
            }
            const { data, error } = await window.sb
                .from('market_listings')
                .update(payload)
                .eq('id', listingId)
                .select()
                .single();
            if (error) throw error;
            return data;
        },

        // ─── Soft delete ───
        async deleteListing(listingId) {
            return await this.updateListing(listingId, { status: 'deleted' });
        },

        // ─── Status helpers ───
        async markSold(listingId) {
            return await this.updateListing(listingId, { status: 'sold' });
        },

        async relistListing(listingId) {
            return await this.updateListing(listingId, { status: 'active' });
        },

        async archiveListing(listingId) {
            return await this.updateListing(listingId, { status: 'archived' });
        },

        // ─── Seller listings ───
        async getSellerListings(sellerId, options = {}) {
            return await this.getListings({
                seller_id: sellerId,
                status: options.status || 'active',
                limit: options.limit || 20,
                offset: options.offset || 0,
                order_by: options.order_by || 'created_at',
                order_dir: options.order_dir || 'desc'
            });
        },

        // ─── Related listings ───
        async getRelatedListings(listingId, categoryId, limit = 6) {
            const { data, error } = await window.sb
                .from('market_listings')
                .select(`
                    *,
                    profiles:seller_id (display_name, avatar_url)
                `)
                .eq('category_id', categoryId)
                .eq('status', 'active')
                .neq('id', listingId)
                .limit(limit)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data;
        },

        // ─── Search (wrapper) ───
        async searchListings(query, options = {}) {
            return await this.getListings({
                search: query,
                limit: options.limit || 20,
                offset: options.offset || 0,
                order_by: 'relevance' // you might want to use a search index for ranking
            });
        },

        // ─── Increment views (RPC) ───
        async incrementViews(listingId) {
            // Call the PostgreSQL RPC function
            const { error } = await window.sb.rpc('increment_listing_views', {
                listing_id: listingId
            });
            if (error) throw error;
            return true;
        },

        // ─── Report listing (unified reports table) ───
        async reportListing(listingId, reason) {
            const userId = await _getUserId();
            const { data, error } = await window.sb
                .from('reports')
                .insert({
                    reporter_id: userId,
                    target_type: 'listing',
                    target_id: listingId,
                    reason: reason || 'Inappropriate content',
                    status: 'pending',
                    created_at: new Date().toISOString()
                })
                .select()
                .single();
            if (error) throw error;
            return data;
        },

        // ─── Favorites (listing_favorites) ───
        async saveListing(listingId) {
            const userId = await _getUserId();
            const { data, error } = await window.sb
                .from('listing_favorites')
                .insert({
                    listing_id: listingId,
                    user_id: userId,
                    created_at: new Date().toISOString()
                })
                .select()
                .single();
            if (error) {
                if (error.code === '23505') return null; // already exists
                throw error;
            }
            return data;
        },

        async unsaveListing(listingId) {
            const userId = await _getUserId();
            const { error } = await window.sb
                .from('listing_favorites')
                .delete()
                .eq('listing_id', listingId)
                .eq('user_id', userId);
            if (error) throw error;
            return true;
        },

        async getSavedListings(options = {}) {
            const userId = await _getUserId();
            let query = window.sb
                .from('listing_favorites')
                .select(`
                    listing_id,
                    created_at,
                    market_listings!inner (
                        *,
                        profiles:seller_id (display_name, avatar_url, verified),
                        market_categories (name),
                        market_subcategories (name)
                    )
                `)
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            const limit = options.limit || 20;
            const offset = options.offset || 0;
            query = query.range(offset, offset + limit - 1);

            const { data, error } = await query;
            if (error) throw error;
            // Flatten
            return data.map(item => ({
                ...item.market_listings,
                saved_at: item.created_at
            }));
        },

        // ─── Additional discovery methods ───

        /**
         * Get listings by category (wrapper around getListings).
         */
        async getListingsByCategory(categoryId, options = {}) {
            return await this.getListings({
                category_id: categoryId,
                ...options
            });
        },

        /**
         * Get listings near a location (lat/lng with simple bounding box).
         * For MVP, we use a rough filter; you could use PostGIS for more accuracy.
         */
        async getNearbyListings(lat, lng, radiusKm = 10, options = {}) {
            // Approximate: 1 degree ~ 111 km
            const delta = radiusKm / 111;
            const minLat = lat - delta;
            const maxLat = lat + delta;
            const minLng = lng - delta;
            const maxLng = lng + delta;

            let query = window.sb
                .from('market_listings')
                .select(`
                    *,
                    profiles:seller_id (display_name, avatar_url, verified),
                    market_categories (name),
                    market_subcategories (name)
                `, { count: 'exact' })
                .eq('status', 'active')
                .gte('lat', minLat)
                .lte('lat', maxLat)
                .gte('lng', minLng)
                .lte('lng', maxLng);

            const limit = options.limit || 20;
            const offset = options.offset || 0;
            query = query.range(offset, offset + limit - 1)
                .order('created_at', { ascending: false });

            const { data, error, count } = await query;
            if (error) throw error;
            return { data, count };
        },

        /**
         * Get recent listings (just order by created_at).
         */
        async getRecentListings(options = {}) {
            return await this.getListings({
                order_by: 'created_at',
                order_dir: 'desc',
                ...options
            });
        },

        /**
         * Get trending listings (by views_count or other metric).
         */
        async getTrendingListings(options = {}) {
            return await this.getListings({
                order_by: 'views_count',
                order_dir: 'desc',
                ...options
            });
        }
    };

    // ──────────────────────────────────────────────
    //  EXPOSE GLOBALLY
    // ──────────────────────────────────────────────
    window.ListingsAPI = ListingsAPI;

    console.log('✅ listings.js loaded (production-ready)');

})();
