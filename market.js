// market.js — FreeUpper Marketplace module
// Depends on globals already exposed by the main script:
// window.getCurrentUser, window.escapeHtml, window.showToast,
// window.copyTextToClipboard, window.lockBodyScroll, window.unlockBodyScroll,
// window.getVerifiedBadgeHTML, window.Router, window.sb,
// window.ListingsAPI, window.CategoryAPI
(function () {
    'use strict';

    // ─── STATE ───────────────────────────────────────────────────────
    let marketCategories = [];
    let marketSubcategories = [];
    let marketListings = [];
    let activeMarketCategory = 'All';
    let activeMarketSubcategory = 'All';
    let maxPriceFilter = null;
    let currentProductId = null;
    let currentImageIndexMap = {};
    let marketDataLoaded = false;
    let _shuffleMarketOnce = false;

    let savedListingsSet = new Set();
    let savedListingsLoaded = false;

    let currentZoomScale = 1;
    let initialPinchDistance = 0;
    let lastTapTime = 0;

    let modalActiveSlideIndex = 0;
    let lightboxActiveIndex = 0;
    let currentActiveProduct = null;

    let touchStartX = 0;
    let touchEndX = 0;

    function shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ─── MARKETPLACE DATA ───────────────────────────────────────────
    async function loadMarketCategories() {
        if (!window.CategoryAPI) return;
        try {
            marketCategories = await window.CategoryAPI.loadCategories();
        } catch (e) {
            console.error('Error loading market categories:', e);
            marketCategories = [];
        }
    }

    async function loadMarketSubcategoriesForCategory(categoryId) {
        if (!window.CategoryAPI) return [];
        try {
            return await window.CategoryAPI.loadSubcategories(categoryId);
        } catch (e) {
            console.error('Error loading subcategories:', e);
            return [];
        }
    }

    async function loadSavedListings() {
        if (!window.ListingsAPI) return;
        const user = window.getCurrentUser();
        if (!user || !user.isLoggedIn) {
            savedListingsSet = new Set();
            savedListingsLoaded = true;
            return;
        }
        try {
            const saved = await window.ListingsAPI.getSavedListings({ limit: 200 });
            savedListingsSet = new Set(saved.map(item => item.id));
        } catch (e) {
            console.warn('loadSavedListings error:', e);
        } finally {
            savedListingsLoaded = true;
        }
    }

    function toggleFavorite(btn, listingId) {
        const user = window.getCurrentUser();
        if (!user || !user.isLoggedIn) {
            triggerToast('Please sign in', 'Sign in to save items');
            return;
        }
        const svg = btn.querySelector('.heart-icon');
        const wasSaved = savedListingsSet.has(listingId);
        if (svg) {
            if (wasSaved) { svg.classList.remove('liked'); svg.setAttribute('fill', 'none'); }
            else { svg.classList.add('liked'); svg.setAttribute('fill', 'currentColor'); }
        }
        try {
            if (wasSaved) {
                window.ListingsAPI.unsaveListing(listingId);
                savedListingsSet.delete(listingId);
                triggerToast('Removed from Saved');
            } else {
                window.ListingsAPI.saveListing(listingId);
                savedListingsSet.add(listingId);
                triggerToast('Saved ✓', 'View it in your profile Market tab');
            }
        } catch (err) {
            if (svg) {
                if (wasSaved) { svg.classList.add('liked'); svg.setAttribute('fill', 'currentColor'); }
                else { svg.classList.remove('liked'); svg.setAttribute('fill', 'none'); }
            }
            triggerToast('Error', err.message || 'Could not update saved items');
        }
    }

    async function loadMarketListings() {
        if (!window.ListingsAPI) return;
        try {
            const result = await window.ListingsAPI.getListings({ status: 'active', limit: 100 });
            marketListings = result.data.map(item => {
                let images = [];
                if (Array.isArray(item.images)) {
                    images = item.images.map(img => typeof img === 'object' && img !== null ? (img.url || '') : String(img)).filter(Boolean);
                } else if (typeof item.images === 'string') {
                    try {
                        const parsed = JSON.parse(item.images);
                        images = Array.isArray(parsed)
                            ? parsed.map(img => typeof img === 'object' && img !== null ? (img.url || '') : String(img)).filter(Boolean)
                            : [item.images];
                    } catch (e) { images = [item.images]; }
                } else { images = []; }
                const verifiedStatus = item.profiles ? (item.profiles.verified_status || (item.profiles.verified ? 'verified' : 'none')) : 'none';
                return {
                    id: item.id,
                    title: item.title,
                    price: item.price,
                    priceFormatted: '₦' + Number(item.price).toLocaleString(),
                    category: item.market_categories ? item.market_categories.name : 'General',
                    subcategory: item.market_subcategories ? item.market_subcategories.name : 'General',
                    seller: item.profiles ? (item.profiles.display_name || item.profiles.username) : 'Unknown',
                    sellerImg: item.profiles ? (item.profiles.avatar_url || '') : '',
                    sellerId: item.seller_id,
                    sellerVerified: verifiedStatus,
                    images: images,
                    location: item.location || 'Nigeria',
                    featured: item.featured || false,
                    description: item.description || '',
                    created_at: item.created_at,
                    whatsapp: item.whatsapp || '',
                    profiles: item.profiles || {},
                    market_categories: item.market_categories || {},
                    market_subcategories: item.market_subcategories || {},
                };
            });
        } catch (e) {
            console.error('Error loading market listings:', e);
            marketListings = [];
        }
    }

    // ─── SKELETONS ───────────────────────────────────────────────────
    function marketSkeletonGrid(c = 6) {
        let h = '';
        for (let i = 0; i < c; i++) {
            h += `<div class="explore-skeleton-card">
                        <div class="skeleton market-skeleton-thumb"></div>
                        <div class="skeleton skeleton-line" style="width:70%;height:12px;margin:8px 0 6px;"></div>
                        <div class="skeleton skeleton-line" style="width:45%;height:10px;margin-bottom:0;"></div>
                      </div>`;
        }
        return h;
    }

    function categoryBarSkeleton(c = 5) {
        let h = '';
        for (let i = 0; i < c; i++) h += `<div class="skeleton category-pill-skeleton" style="width:${64 + (i % 3) * 16}px;"></div>`;
        return h;
    }

    // ─── CATEGORY BARS ───────────────────────────────────────────────
    function renderMarketCategoryBars() {
        const mainBar = document.getElementById('mainCategoriesBar');
        if (!mainBar) return;
        let html = `<button onclick="selectMarketCategory('All')" class="px-4 py-2 rounded-xl text-xs font-bold flex-shrink-0 transition ${activeMarketCategory === 'All' ? 'bg-brand-600 text-white shadow-md shadow-brand-500/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">All Items</button>`;
        marketCategories.forEach(cat => {
            const isSelected = activeMarketCategory === cat.name;
            html += `<button onclick="selectMarketCategory('${cat.name.replace(/'/g, "\\'")}')" class="px-4 py-2 rounded-xl text-xs font-bold flex-shrink-0 transition ${isSelected ? 'bg-brand-600 text-white shadow-md shadow-brand-500/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">${cat.name}</button>`;
        });
        mainBar.innerHTML = html;

        const subBar = document.getElementById('subCategoriesBar');
        if (!subBar) return;
        if (activeMarketCategory === 'All') { subBar.classList.add('hidden'); subBar.innerHTML = ''; return; }
        const cat = marketCategories.find(c => c.name === activeMarketCategory);
        if (!cat) { subBar.classList.add('hidden'); return; }
        const subcats = marketSubcategories.filter(s => s.category_id === cat.id);
        subBar.classList.remove('hidden');
        let subHtml = `<button onclick="selectMarketSubcategory('All')" class="px-3 py-1.5 rounded-lg text-xs font-bold flex-shrink-0 transition ${activeMarketSubcategory === 'All' ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-600'}">All ${activeMarketCategory}</button>`;
        subcats.forEach(sub => {
            const isSelected = activeMarketSubcategory === sub.name;
            subHtml += `<button onclick="selectMarketSubcategory('${sub.name.replace(/'/g, "\\'")}')" class="px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition ${isSelected ? 'bg-brand-100 text-brand-600 font-bold' : 'bg-gray-100 text-gray-600'}">${sub.name}</button>`;
        });
        subBar.innerHTML = subHtml;
    }

    function selectMarketCategory(cat) {
        activeMarketCategory = cat;
        activeMarketSubcategory = 'All';
        renderMarketCategoryBars();
        applyMarketFiltersAndRender();
        if (cat !== 'All') {
            const catObj = marketCategories.find(c => c.name === cat);
            if (catObj) {
                loadMarketSubcategoriesForCategory(catObj.id).then(subs => {
                    marketSubcategories = subs;
                    renderMarketCategoryBars();
                    applyMarketFiltersAndRender();
                });
            }
        } else {
            marketSubcategories = [];
            renderMarketCategoryBars();
            applyMarketFiltersAndRender();
        }
    }

    function selectMarketSubcategory(sub) {
        activeMarketSubcategory = sub;
        renderMarketCategoryBars();
        applyMarketFiltersAndRender();
    }

    function applyMarketFiltersAndRender() {
        let filtered = [...marketListings];
        if (activeMarketCategory !== 'All') {
            filtered = filtered.filter(p => p.category === activeMarketCategory);
            if (activeMarketSubcategory !== 'All') filtered = filtered.filter(p => p.subcategory === activeMarketSubcategory);
        }
        if (maxPriceFilter !== null && !isNaN(maxPriceFilter) && maxPriceFilter > 0) filtered = filtered.filter(p => p.price <= maxPriceFilter);
        if (_shuffleMarketOnce) { filtered = shuffleArray(filtered); _shuffleMarketOnce = false; }
        renderMarketProducts(filtered);
    }

    function renderMarketProducts(items) {
        const featuredGrid = document.getElementById('featuredGrid');
        const newlyGrid = document.getElementById('newlyGrid');
        const emptyState = document.getElementById('emptyState');
        const featuredSection = document.getElementById('featuredSection');
        const newlySection = document.getElementById('newlySection');
        if (!featuredGrid || !newlyGrid) return;

        featuredGrid.innerHTML = '';
        newlyGrid.innerHTML = '';

        if (items.length === 0) {
            emptyState.classList.remove('hidden'); emptyState.classList.add('flex');
            featuredSection.classList.add('hidden'); newlySection.classList.add('hidden');
            return;
        }
        emptyState.classList.add('hidden'); emptyState.classList.remove('flex');
        featuredSection.classList.remove('hidden'); newlySection.classList.remove('hidden');

        items.filter(i => i.featured).forEach(item => featuredGrid.innerHTML += createMarketCardHTML(item));
        items.filter(i => !i.featured).forEach(item => newlyGrid.innerHTML += createMarketCardHTML(item));
    }

    function createMarketCardHTML(item) {
        if (!(item.id in currentImageIndexMap)) currentImageIndexMap[item.id] = 0;
        const activeIdx = currentImageIndexMap[item.id];
        const images = (item.images && Array.isArray(item.images) && item.images.length > 0) ? item.images : [''];

        let dotsHTML = '';
        if (images.length > 1) {
            dotsHTML = `<div class="absolute bottom-14 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-2 py-1 rounded-full z-10">`;
            images.forEach((_, idx) => {
                dotsHTML += `<button onclick="event.stopPropagation(); changeMarketImage('${item.id}', ${idx}, this)" class="h-1.5 rounded-full transition-all ${idx === activeIdx ? 'bg-white w-3' : 'bg-white/50 w-1.5'}"></button>`;
            });
            dotsHTML += `</div>`;
        }

        let sellerChip = `<div class="flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-2 py-0.5 rounded-full text-[11px] max-w-full">`;
        sellerChip += `<img src="${item.sellerImg}" class="w-3.5 h-3.5 rounded-full object-cover flex-shrink-0" alt="${item.seller}" onerror="this.style.display='none'">`;
        sellerChip += `<span class="font-medium truncate">${item.seller}</span>`;
        if (window.getVerifiedBadgeHTML) sellerChip += window.getVerifiedBadgeHTML(item.sellerVerified);
        sellerChip += `</div>`;

        const isSaved = savedListingsSet.has(item.id);

        return `
            <div onclick="window.openProductModal('${item.id}')" class="group cursor-pointer product-card">
                <div class="relative aspect-square rounded-2xl overflow-hidden bg-gray-100 mb-2">
                    <img id="market-card-img-${item.id}" src="${images[activeIdx]}" alt="${item.title}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
                    ${dotsHTML}
                    <button onclick="event.stopPropagation(); toggleFavorite(this, '${item.id}')" class="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/40 transition">
                        <svg class="w-4 h-4 heart-icon ${isSaved ? 'liked' : ''}" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                        </svg>
                    </button>
                    <div class="absolute bottom-0 inset-x-0 p-2.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-col items-start gap-1 text-white">
                        ${sellerChip}
                        <span class="font-black text-sm sm:text-base text-white tracking-tight">${item.priceFormatted}</span>
                    </div>
                </div>
                <h3 class="font-bold text-gray-900 text-sm truncate">${item.title}</h3>
                <div class="flex items-center gap-1.5 text-[11px] text-gray-500 mt-0.5">
                    <span class="font-semibold text-brand-600">${item.category}</span><span>•</span><span>${item.subcategory}</span>
                </div>
            </div>
        `;
    }

    function changeMarketImage(productId, imageIdx, btnEl) {
        currentImageIndexMap[productId] = imageIdx;
        const product = marketListings.find(p => p.id === productId);
        if (!product || !product.images || !product.images[imageIdx]) return;
        const imgEl = document.getElementById(`market-card-img-${productId}`);
        if (imgEl) imgEl.src = product.images[imageIdx];
        const parent = btnEl ? btnEl.parentElement : null;
        if (parent) {
            parent.querySelectorAll('button').forEach((dot, idx) => {
                dot.className = idx === imageIdx ? 'h-1.5 rounded-full transition-all bg-white w-3' : 'h-1.5 rounded-full transition-all bg-white/50 w-1.5';
            });
        }
    }

    // ─── PRODUCT MODAL ────────────────────────────────────────────────
    function openProductModal(id) {
        const product = marketListings.find(p => p.id === id);
        if (!product) return;
        currentActiveProduct = product;
        currentProductId = id;
        modalActiveSlideIndex = 0;

        document.getElementById('modalTitle').textContent = product.title;
        document.getElementById('modalPrice').textContent = product.priceFormatted;
        document.getElementById('modalCategoryBadge').textContent = product.category;
        document.getElementById('modalSubcategoryBadge').textContent = product.subcategory;
        if (window.getVerifiedBadgeHTML) {
            document.getElementById('modalSellerName').innerHTML = `${window.escapeHtml(product.seller)} ${window.getVerifiedBadgeHTML(product.sellerVerified)}`;
        } else {
            document.getElementById('modalSellerName').textContent = product.seller;
        }
        document.getElementById('modalSellerImg').src = product.sellerImg || '';
        document.getElementById('modalLocationText').textContent = product.location + ' • Active Today';
        document.getElementById('modalDesc').textContent = product.description || 'No description provided.';

        const whatsappNumber = product.whatsapp || product.profiles?.phone || '';
        if (whatsappNumber) {
            const cleanNumber = whatsappNumber.replace(/\D/g, '');
            const message = encodeURIComponent(`Hello ${product.seller}, I saw your listing for "${product.title}" (${product.priceFormatted}) under ${product.category} -> ${product.subcategory} on FreeUpper. Is it available?`);
            document.getElementById('whatsappBtn').href = `https://wa.me/${cleanNumber}?text=${message}`;
            document.getElementById('whatsappBtn').style.display = 'flex';
        } else {
            document.getElementById('whatsappBtn').style.display = 'none';
        }

        renderModalCarousel();
        document.getElementById('productModal').classList.remove('hidden');
        document.getElementById('productModal').classList.add('flex');
        document.body.classList.add('market-fullscreen-open');
    }

    function closeProductModal() {
        document.getElementById('productModal').classList.add('hidden');
        document.getElementById('productModal').classList.remove('flex');
        document.body.classList.remove('market-fullscreen-open');
    }

    function renderModalCarousel() {
        if (!currentActiveProduct) return;
        const images = currentActiveProduct.images || [];
        const slidesContainer = document.getElementById('modalSlidesContainer');
        const dotsContainer = document.getElementById('modalDots');
        const badge = document.getElementById('modalImageBadge');
        const prevBtn = document.getElementById('prevSlideBtn');
        const nextBtn = document.getElementById('nextSlideBtn');

        slidesContainer.innerHTML = '';
        dotsContainer.innerHTML = '';

        images.forEach((img) => {
            slidesContainer.innerHTML += `<div class="w-full h-full flex-none shrink-0 flex items-center justify-center bg-gray-900 overflow-hidden"><img src="${img}" class="w-full h-full object-cover select-none pointer-events-none" alt="Product Slide"></div>`;
        });

        if (images.length > 1) {
            dotsContainer.parentElement.classList.remove('hidden');
            badge.classList.remove('hidden'); prevBtn.classList.remove('hidden'); nextBtn.classList.remove('hidden');
            images.forEach((_, idx) => {
                dotsContainer.innerHTML += `<button onclick="event.stopPropagation(); goToModalSlide(${idx})" class="h-1.5 rounded-full transition-all ${idx === modalActiveSlideIndex ? 'bg-white w-3' : 'bg-white/40 w-1.5'}"></button>`;
            });
        } else {
            dotsContainer.parentElement.classList.add('hidden');
            badge.classList.add('hidden'); prevBtn.classList.add('hidden'); nextBtn.classList.add('hidden');
        }
        updateModalSlidePosition();
    }

    function updateModalSlidePosition() {
        if (!currentActiveProduct) return;
        const images = currentActiveProduct.images || [];
        const container = document.getElementById('modalSlidesContainer');
        const badge = document.getElementById('modalImageBadge');
        container.style.transform = `translateX(-${modalActiveSlideIndex * 100}%)`;
        badge.textContent = `${modalActiveSlideIndex + 1} / ${images.length}`;
        document.getElementById('modalDots').querySelectorAll('button').forEach((dot, idx) => {
            dot.className = idx === modalActiveSlideIndex ? 'h-1.5 rounded-full transition-all bg-white w-3' : 'h-1.5 rounded-full transition-all bg-white/40 w-1.5';
        });
    }

    function nextModalSlide() {
        if (!currentActiveProduct) return;
        const images = currentActiveProduct.images || [];
        modalActiveSlideIndex = (modalActiveSlideIndex + 1) % images.length;
        updateModalSlidePosition();
    }

    function prevModalSlide() {
        if (!currentActiveProduct) return;
        const images = currentActiveProduct.images || [];
        modalActiveSlideIndex = (modalActiveSlideIndex - 1 + images.length) % images.length;
        updateModalSlidePosition();
    }

    function goToModalSlide(idx) { modalActiveSlideIndex = idx; updateModalSlidePosition(); }

    // ─── FULLSCREEN LIGHTBOX (product images) ─────────────────────────
    function openFullscreenLightbox() {
        if (!currentActiveProduct) return;
        lightboxActiveIndex = modalActiveSlideIndex;
        renderLightbox();
        document.getElementById('fullscreenLightbox').classList.remove('hidden');
        document.getElementById('fullscreenLightbox').classList.add('flex');
        window.lockBodyScroll();
    }

    function closeFullscreenLightbox() {
        resetZoom();
        document.getElementById('fullscreenLightbox').classList.add('hidden');
        document.getElementById('fullscreenLightbox').classList.remove('flex');
        window.unlockBodyScroll();
    }

    function renderLightbox() {
        if (!currentActiveProduct) return;
        const images = currentActiveProduct.images || [];
        const container = document.getElementById('lightboxSlidesContainer');
        const dotsContainer = document.getElementById('lightboxDots');
        const prevBtn = document.getElementById('lightboxPrevBtn');
        const nextBtn = document.getElementById('lightboxNextBtn');

        container.innerHTML = '';
        dotsContainer.innerHTML = '';

        images.forEach((img, idx) => {
            container.innerHTML += `<div class="w-full h-full flex-none shrink-0 flex items-center justify-center p-2"><img id="lightbox-img-${idx}" src="${img}" class="max-w-full max-h-full object-contain rounded-xl select-none transition-transform duration-200 cursor-zoom-in" alt="Full Image View"></div>`;
        });

        if (images.length > 1) {
            prevBtn.classList.remove('hidden'); nextBtn.classList.remove('hidden'); dotsContainer.classList.remove('hidden');
            images.forEach((_, idx) => {
                dotsContainer.innerHTML += `<button onclick="goToLightboxSlide(${idx})" class="h-2 rounded-full transition-all ${idx === lightboxActiveIndex ? 'bg-white w-4' : 'bg-white/30 w-2'}"></button>`;
            });
        } else {
            prevBtn.classList.add('hidden'); nextBtn.classList.add('hidden'); dotsContainer.classList.add('hidden');
        }
        updateLightboxPosition();
    }

    function updateLightboxPosition() {
        if (!currentActiveProduct) return;
        resetZoom();
        const images = currentActiveProduct.images || [];
        const container = document.getElementById('lightboxSlidesContainer');
        const badge = document.getElementById('lightboxBadge');
        container.style.transform = `translateX(-${lightboxActiveIndex * 100}%)`;
        badge.textContent = `${lightboxActiveIndex + 1} / ${images.length}`;
        document.getElementById('lightboxDots').querySelectorAll('button').forEach((dot, idx) => {
            dot.className = idx === lightboxActiveIndex ? 'h-2 rounded-full transition-all bg-white w-4' : 'h-2 rounded-full transition-all bg-white/30 w-2';
        });
        modalActiveSlideIndex = lightboxActiveIndex;
        updateModalSlidePosition();
    }

    function nextLightboxSlide() {
        if (!currentActiveProduct) return;
        const images = currentActiveProduct.images || [];
        lightboxActiveIndex = (lightboxActiveIndex + 1) % images.length;
        updateLightboxPosition();
    }

    function prevLightboxSlide() {
        if (!currentActiveProduct) return;
        const images = currentActiveProduct.images || [];
        lightboxActiveIndex = (lightboxActiveIndex - 1 + images.length) % images.length;
        updateLightboxPosition();
    }

    function goToLightboxSlide(idx) { lightboxActiveIndex = idx; updateLightboxPosition(); }

    function applyImageZoom(scale) {
        currentZoomScale = Math.min(Math.max(1, scale), 3.5);
        const activeImg = document.getElementById(`lightbox-img-${lightboxActiveIndex}`);
        if (activeImg) activeImg.style.transform = `scale(${currentZoomScale})`;
    }

    function resetZoom() {
        currentZoomScale = 1;
        const activeImg = document.getElementById(`lightbox-img-${lightboxActiveIndex}`);
        if (activeImg) activeImg.style.transform = `scale(1)`;
    }

    // ─── TOUCH GESTURES ────────────────────────────────────────────────
    function setupMarketTouchGestures() {
        const lightboxTrack = document.getElementById('lightboxTrack');
        const carouselTrack = document.getElementById('modalCarouselTrack');
        if (!lightboxTrack || !carouselTrack) return;

        lightboxTrack.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                initialPinchDistance = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
            } else if (e.touches.length === 1) {
                touchStartX = e.changedTouches[0].screenX;
                const now = new Date().getTime();
                if (now - lastTapTime < 300) { if (currentZoomScale > 1) resetZoom(); else applyImageZoom(2.2); }
                lastTapTime = now;
            }
        }, { passive: true });

        lightboxTrack.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                const currentDist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                applyImageZoom(currentZoomScale * (currentDist / initialPinchDistance));
                initialPinchDistance = currentDist;
            }
        }, { passive: true });

        lightboxTrack.addEventListener('touchend', (e) => {
            if (e.changedTouches.length === 1 && currentZoomScale === 1) {
                touchEndX = e.changedTouches[0].screenX;
                if (touchStartX - touchEndX > 40) nextLightboxSlide();
                else if (touchEndX - touchStartX > 40) prevLightboxSlide();
            }
        }, { passive: true });

        carouselTrack.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
        carouselTrack.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            if (touchStartX - touchEndX > 40) nextModalSlide();
            else if (touchEndX - touchStartX > 40) prevModalSlide();
        }, { passive: true });
    }

    // ─── SHARE / SELLER ─────────────────────────────────────────────
    function shareCurrentProduct() {
        if (!currentActiveProduct) return;
        const productUrl = window.location.origin + '/?product=' + currentActiveProduct.id;
        const shareData = { title: currentActiveProduct.title, text: `Check out ${currentActiveProduct.title} (${currentActiveProduct.priceFormatted}) on FreeUpper!`, url: productUrl };
        if (navigator.share) {
            navigator.share(shareData).then(() => triggerToast('Link Shared 🎉', 'Product shared successfully!')).catch(() => {});
        } else {
            window.copyTextToClipboard(productUrl);
            triggerToast('Link Copied 🔗', 'Product URL copied to clipboard!');
        }
    }

    function openSellerProfile() {
        if (!currentActiveProduct) return;
        if (currentActiveProduct.sellerId) window.Router.openProfile(currentActiveProduct.sellerId);
        else triggerToast('Profile not found', 'Seller information unavailable.');
    }

    // ─── FILTER / SEE-ALL MODALS ────────────────────────────────────
    function openFilterModal() { document.getElementById('filterModal').classList.remove('hidden'); }
    function closeFilterModal() { document.getElementById('filterModal').classList.add('hidden'); }
    function closeSeeAllModal() { document.getElementById('seeAllModal').classList.add('hidden'); document.getElementById('seeAllModal').classList.remove('flex'); }

    function openSeeAllModal(title, isFeatured) {
        document.getElementById('seeAllTitle').textContent = title;
        const grid = document.getElementById('seeAllGrid');
        grid.innerHTML = '';
        marketListings.filter(p => isFeatured ? p.featured : !p.featured).forEach(item => { grid.innerHTML += createMarketCardHTML(item); });
        document.getElementById('seeAllModal').classList.remove('hidden');
        document.getElementById('seeAllModal').classList.add('flex');
    }

    function triggerToast(title, sub) { window.showToast(title + (sub ? ' — ' + sub : ''), 'p'); }

    function applyFilters() {
        const val = parseFloat(document.getElementById('filterMaxPrice').value);
        maxPriceFilter = (!isNaN(val) && val > 0) ? val : null;
        applyMarketFiltersAndRender();
        closeFilterModal();
        if (maxPriceFilter) triggerToast('Filter Applied 🎯', `Showing items priced up to ₦${maxPriceFilter.toLocaleString()}`);
    }

    function resetFilters() {
        document.getElementById('filterMaxPrice').value = '';
        maxPriceFilter = null;
        applyMarketFiltersAndRender();
        closeFilterModal();
    }

    function handleMarketSearch(query) {
        const clean = query.toLowerCase().trim();
        if (!clean) { applyMarketFiltersAndRender(); return; }
        renderMarketProducts(marketListings.filter(p =>
            p.title.toLowerCase().includes(clean) || p.category.toLowerCase().includes(clean) ||
            p.subcategory.toLowerCase().includes(clean) || p.seller.toLowerCase().includes(clean)
        ));
    }

    // ─── TAB TEMPLATE ────────────────────────────────────────────────
    function renderMarketView() {
        return `
                <div class="market-main-content">
                    <div class="p-4 sm:p-6 space-y-4">
                        <div class="flex items-center gap-2 sm:gap-3">
                            <div class="relative flex-1">
                                <span class="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-gray-400">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                                </span>
                                <input type="text" id="searchInput" oninput="handleMarketSearch(this.value)" placeholder="Search title, category, subcategory..."
                                       class="w-full pl-10 pr-4 py-3 bg-gray-100/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition">
                            </div>
                            <button onclick="openFilterModal()" class="flex items-center gap-1.5 px-4 py-3 bg-brand-50 text-brand-600 rounded-xl text-sm font-semibold hover:bg-brand-100 transition">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>
                                <span>Filter</span>
                            </button>
                        </div>
                        <div>
                            <div class="flex items-center gap-3 overflow-x-auto no-scrollbar py-1" id="mainCategoriesBar"></div>
                            <div class="hidden flex items-center gap-2 overflow-x-auto no-scrollbar pt-3 border-t border-gray-100 mt-2" id="subCategoriesBar"></div>
                        </div>
                    </div>
                    <div id="emptyState" class="hidden py-16 px-4 text-center flex-col items-center justify-center">
                        <div class="w-20 h-20 bg-brand-50 rounded-3xl flex items-center justify-center text-brand-600 mb-4 shadow-sm border border-brand-100">
                            <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                        </div>
                        <h3 class="text-base font-bold text-gray-900">No products here yet</h3>
                        <p class="text-xs text-gray-500 mt-1 max-w-xs mx-auto">Listings for this category are launching soon. Stay tuned or check back later!</p>
                        <button onclick="selectMarketCategory('All')" class="mt-5 px-4 py-2.5 bg-brand-600 text-white font-bold rounded-xl text-xs hover:bg-brand-700 transition shadow-md shadow-brand-500/20">Explore All Products</button>
                    </div>
                    <section id="featuredSection" class="px-4 sm:px-6 mb-8">
                        <div class="flex justify-between items-center mb-3">
                            <h2 class="text-lg font-bold text-gray-900 flex items-center gap-1.5">Featured Today 🔥</h2>
                            <button onclick="openSeeAllModal('Featured Today 🔥', true)" class="text-sm font-semibold text-brand-600 hover:underline">See all</button>
                        </div>
                        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4" id="featuredGrid"></div>
                    </section>
                    <section id="newlySection" class="px-4 sm:px-6 mb-8">
                        <div class="flex justify-between items-center mb-3">
                            <h2 class="text-lg font-bold text-gray-900 flex items-center gap-1.5">Newly Listed ✨</h2>
                            <button onclick="openSeeAllModal('Newly Listed ✨', false)" class="text-sm font-semibold text-brand-600 hover:underline">See all</button>
                        </div>
                        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4" id="newlyGrid"></div>
                    </section>
                    <section class="px-4 sm:px-6 mb-8">
                        <div class="bg-brand-50 rounded-2xl p-4 flex items-center justify-between gap-3 border border-brand-100">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center flex-shrink-0">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                                </div>
                                <div>
                                    <h4 class="font-bold text-gray-900 text-sm">Buy safely on FreeUpper</h4>
                                    <p class="text-xs text-gray-500 mt-0.5">Chat with verified sellers directly via DM or WhatsApp.</p>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            `;
    }

    // ─── PUBLIC ENTRY POINTS (called from index.html) ─────────────────
    function renderMarketTab(container) {
        container.innerHTML = renderMarketView();
        requestAnimationFrame(async () => {
            if (!marketDataLoaded) {
                const fg = document.getElementById('featuredGrid');
                const ng = document.getElementById('newlyGrid');
                const mb = document.getElementById('mainCategoriesBar');
                if (fg) fg.innerHTML = marketSkeletonGrid();
                if (ng) ng.innerHTML = marketSkeletonGrid();
                if (mb) mb.innerHTML = categoryBarSkeleton();
                await Promise.all([loadMarketCategories(), loadMarketListings(), loadSavedListings()]);
                marketDataLoaded = true;
            }
            renderMarketCategoryBars();
            applyMarketFiltersAndRender();
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.oninput = function () { handleMarketSearch(this.value); };
        });
    }

    function triggerMarketRefresh() {
        _shuffleMarketOnce = true;
        marketDataLoaded = false;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupMarketTouchGestures);
    else setupMarketTouchGestures();

    // ─── EXPOSE GLOBALLY (same names the inline onclick="" HTML expects) ───
    window.renderMarketTab = renderMarketTab;
    window.triggerMarketRefresh = triggerMarketRefresh;
    window.selectMarketCategory = selectMarketCategory;
    window.selectMarketSubcategory = selectMarketSubcategory;
    window.openProductModal = openProductModal;
    window.closeProductModal = closeProductModal;
    window.shareCurrentProduct = shareCurrentProduct;
    window.openSellerProfile = openSellerProfile;
    window.openFilterModal = openFilterModal;
    window.closeFilterModal = closeFilterModal;
    window.applyFilters = applyFilters;
    window.resetFilters = resetFilters;
    window.openSeeAllModal = openSeeAllModal;
    window.closeSeeAllModal = closeSeeAllModal;
    window.handleMarketSearch = handleMarketSearch;
    window.toggleFavorite = toggleFavorite;
    window.changeMarketImage = changeMarketImage;
    window.triggerToast = triggerToast;
    window.openFullscreenLightbox = openFullscreenLightbox;
    window.closeFullscreenLightbox = closeFullscreenLightbox;
    window.nextLightboxSlide = nextLightboxSlide;
    window.prevLightboxSlide = prevLightboxSlide;
    window.goToLightboxSlide = goToLightboxSlide;
    window.resetZoom = resetZoom;
    window.nextModalSlide = nextModalSlide;
    window.prevModalSlide = prevModalSlide;
    window.goToModalSlide = goToModalSlide;

})();
