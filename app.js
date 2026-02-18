import { store } from './store.js';

// --- Utils ---
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0
    }).format(amount);
};

// --- Rendering Helpers ---

const renderTransactionItem = (tx, asset) => {
    const isNegative = tx.type === 'sell';
    const amountColor = (tx.type === 'buy' || tx.type === 'update') ? 'var(--text-primary)' : 'var(--danger)';

    return `
        <div class="glass-panel flex-between list-item">
            <div style="flex: 1;">
                <div class="font-medium">${asset ? asset.name : 'Unknown Asset'}</div>
                <div class="text-sm text-muted">${new Date(tx.date).toLocaleDateString()}</div>
            </div>
            <div class="text-right mr-2">
                <div class="font-semibold" style="color: ${amountColor}">
                    ${isNegative ? '-' : ''}${formatCurrency(tx.amount)}
                </div>
            </div>
            <div class="flex-row gap-2">
                <button class="icon-btn js-edit-tx" data-id="${tx.id}" aria-label="Edit">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button class="icon-btn js-delete-tx" data-id="${tx.id}" aria-label="Delete" style="color: var(--danger);">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </div>
    `;
};

const renderAssetCard = (asset) => {
    const color = asset.currentValue < 0 ? 'var(--danger)' : 'var(--accent-primary)';
    return `
        <div class="glass-panel asset-card-mini">
            <div class="text-sm text-muted mb-2">${asset.category}</div>
            <div class="font-semibold mb-1" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${asset.name}</div>
            <div class="font-medium" style="color: ${color}">${formatCurrency(asset.currentValue)}</div>
            ${asset.quantity > 0 ? `<div class="text-sm text-muted mt-1">${Number(asset.quantity).toLocaleString()} units</div>` : ''}
        </div>
    `;
};

const renderAssetListItem = (asset) => {
    const color = asset.currentValue < 0 ? 'var(--danger)' : 'var(--accent-primary)';
    return `
        <div class="glass-panel flex-between list-item">
            <div style="flex: 1; min-width: 0;">
                <div class="text-sm text-muted mb-2">${asset.category}</div>
                <div class="font-semibold" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${asset.name}</div>
            </div>
            <div class="text-right mr-2">
                <div class="font-medium" style="color: ${color}">${formatCurrency(asset.currentValue)}</div>
                ${asset.quantity > 0 ? `<div class="text-sm text-muted">${Number(asset.quantity).toLocaleString()} u</div>` : ''}
            </div>
            <div class="flex-row gap-2">
                <button class="icon-btn js-edit-asset" data-id="${asset.id}" aria-label="Edit asset">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button class="icon-btn js-delete-asset" data-id="${asset.id}" aria-label="Delete asset" style="color: var(--danger);">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </div>
    `;
};

// --- Validation Helpers ---

const showFieldError = (inputEl, message) => {
    inputEl.classList.add('input-error');
    const existing = inputEl.parentElement.querySelector('.field-error');
    if (existing) existing.remove();
    const err = document.createElement('p');
    err.className = 'field-error';
    err.textContent = message;
    inputEl.after(err);
};

const clearFieldErrors = (formEl) => {
    formEl.querySelectorAll('.field-error').forEach(e => e.remove());
    formEl.querySelectorAll('.input-error').forEach(e => e.classList.remove('input-error'));
};

const showToast = (message, isError = false) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.borderColor = isError ? 'var(--danger)' : 'var(--success)';
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
};

// --- UI Components ---

const renderDashboard = (state) => {
    // Net Worth
    const totalEl = document.getElementById('total-net-worth');
    if (totalEl) {
        totalEl.textContent = formatCurrency(store.totalNetWorth);
    }

    // Monthly trend
    const trendEl = document.getElementById('trend-value');
    const trendWrap = trendEl ? trendEl.closest('.trend') : null;
    if (trendEl && trendWrap) {
        const history = store.getHistory('all');
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        const monthAgoStr = monthAgo.toISOString().split('T')[0];

        let prevTotal = 0;
        for (let i = 0; i < history.labels.length; i++) {
            if (history.labels[i] <= monthAgoStr) {
                prevTotal = history.data[i];
            }
        }

        const currTotal = store.totalNetWorth;
        if (prevTotal === 0) {
            trendEl.textContent = 'N/A';
            trendWrap.className = 'trend';
        } else {
            const pct = ((currTotal - prevTotal) / Math.abs(prevTotal)) * 100;
            const sign = pct >= 0 ? '+' : '';
            trendEl.textContent = `${sign}${pct.toFixed(1)}%`;
            trendWrap.className = `trend ${pct >= 0 ? 'positive' : 'negative'}`;
        }
    }

    // Render Recent Transactions
    const recentEl = document.getElementById('recent-transactions');
    if (recentEl) {
        if (state.transactions.length > 0) {
            recentEl.innerHTML = state.transactions.slice(0, 5).map(tx => {
                const asset = state.assets.find(a => a.id === tx.assetId);
                return renderTransactionItem(tx, asset);
            }).join('');
        } else {
            recentEl.innerHTML = `<div class="empty-state">No transactions yet</div>`;
        }
    }

    // Render Assets Preview
    const assetsEl = document.getElementById('assets-preview');
    if (assetsEl) {
        if (state.assets.length > 0) {
            assetsEl.innerHTML = state.assets.map(renderAssetCard).join('');
        } else {
            assetsEl.innerHTML = `
                <div class="glass-panel asset-card-mini flex-center text-muted" style="min-width: 200px;">
                    Add your first asset
                </div>
            `;
        }
    }
};

// --- Initialization ---

// DOM Elements
const modal = document.getElementById('modal-container');
const btnAdd = document.getElementById('fab-add');
const btnCloseModal = document.getElementById('close-modal');
const formTransaction = document.getElementById('form-transaction');
const formAsset = document.getElementById('form-asset');
const selectAsset = document.getElementById('tx-asset');
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Settings Elements
const btnSettings = document.getElementById('btn-settings');
const modalSettings = document.getElementById('modal-settings');
const btnCloseSettings = document.getElementById('close-settings');
const btnExport = document.getElementById('btn-export');
const btnImportTrigger = document.getElementById('btn-import-trigger');
const fileImport = document.getElementById('file-import');


// --- Helper Functions ---

const openModal = () => {
    if (!modal) return;
    modal.classList.remove('hidden');
    // Default to today
    const dateInput = document.getElementById('tx-date');
    if (dateInput) dateInput.valueAsDate = new Date();

    const assetDateInput = document.getElementById('asset-date');
    if (assetDateInput) assetDateInput.valueAsDate = new Date();

    populateAssetSelect();

    // Reset form state properly
    const typeRadios = document.querySelectorAll('input[name="tx-type"]');
    typeRadios.forEach(r => {
        if (r.value === 'buy') r.checked = true;
    });
    handleTransactionTypeChange('buy');

    // If no assets, switch to asset tab automatically
    if (store.state.assets.length === 0) {
        switchTab('tab-asset');
    } else {
        switchTab('tab-transaction');
    }
};

const closeModal = () => {
    if (!modal) return;
    modal.classList.add('hidden');
    if (formTransaction) {
        formTransaction.reset();
        const btnSubmit = formTransaction.querySelector('button[type="submit"]');
        if (btnSubmit) btnSubmit.textContent = 'Save Transaction';
    }
    editingTransactionId = null;
    editingAssetId = null;
    if (formAsset) {
        formAsset.reset();
        ['asset-initial-value', 'asset-quantity', 'asset-date'].forEach(fId => {
            const el = document.getElementById(fId);
            if (el) el.closest('.form-group').classList.remove('hidden');
        });
        const btnSubmitAsset = formAsset.querySelector('button[type="submit"]');
        if (btnSubmitAsset) btnSubmitAsset.textContent = 'Create Asset';
    }
};

const openSettings = () => {
    if (modalSettings) modalSettings.classList.remove('hidden');
};

const closeSettings = () => {
    if (modalSettings) modalSettings.classList.add('hidden');
};

const handleExport = () => {
    const json = store.exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `net-worth-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const result = store.importData(e.target.result);
        if (result.success) {
            showToast('Data imported successfully!');
            closeSettings();
        } else {
            showToast('Import failed: ' + result.error, true);
        }
    };
    reader.readAsText(file);
};


const switchTab = (tabId) => {
    tabs.forEach(t => {
        if (t.dataset.tab === tabId) t.classList.add('active');
        else t.classList.remove('active');
    });
    tabContents.forEach(c => {
        if (c.id === tabId) c.classList.remove('hidden');
        else c.classList.add('hidden');
    });
};

const populateAssetSelect = () => {
    if (!selectAsset) return;
    const assets = store.state.assets;
    const optionsHtml = ['<option value="" disabled selected>Select an asset</option>'];

    assets.forEach(asset => {
        optionsHtml.push(`<option value="${asset.id}">${asset.name} (${formatCurrency(asset.currentValue)})</option>`);
    });

    selectAsset.innerHTML = optionsHtml.join('');

    // Also populate From Asset select
    const selectFromAsset = document.getElementById('tx-from-asset');
    if (selectFromAsset) {
        selectFromAsset.innerHTML = ['<option value="" disabled selected>Select Source Asset</option>', ...optionsHtml.slice(1)].join('');
    }
};

const handleTransactionTypeChange = (type) => {
    const groupAsset = document.getElementById('group-asset');
    const groupFromAsset = document.getElementById('group-from-asset');
    const labelAsset = document.querySelector('label[for="tx-asset"]');
    const groupQuantity = document.getElementById('group-quantity');

    // Default visibility
    if (groupQuantity) groupQuantity.classList.remove('hidden');

    if (type === 'move') {
        groupFromAsset.classList.remove('hidden');
        if (labelAsset) labelAsset.textContent = 'To Asset';
        document.getElementById('tx-from-asset').required = true;
    } else if (type === 'update') {
        // Value updates might not need quantity unless explicitly creating a checkpoint
        // But let's keep it visible so users can update quantity count if needed
        groupFromAsset.classList.add('hidden');
        if (labelAsset) labelAsset.textContent = 'Asset';
        document.getElementById('tx-from-asset').required = false;
        // Optionally hide quantity for 'update' if it's confusing, but explicitly setting it is better.
        // Let's hide it for 'Value' update to keep it simple, assuming 'Value' is just for total amount.
        if (groupQuantity) groupQuantity.classList.add('hidden');
    } else {
        groupFromAsset.classList.add('hidden');
        if (labelAsset) labelAsset.textContent = 'Asset';
        document.getElementById('tx-from-asset').required = false;
    }
};

// --- Event Listeners ---

const setupEventListeners = () => {
    if (btnAdd) btnAdd.addEventListener('click', openModal);
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);

    // Close on backdrop click
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }

    // Settings Listeners
    if (btnSettings) btnSettings.addEventListener('click', openSettings);
    if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettings);
    if (modalSettings) {
        modalSettings.addEventListener('click', (e) => {
            if (e.target === modalSettings) closeSettings();
        });
    }
    if (btnExport) btnExport.addEventListener('click', handleExport);
    if (btnImportTrigger) {
        btnImportTrigger.addEventListener('click', () => {
            if (fileImport) fileImport.click();
        });
    }
    if (fileImport) fileImport.addEventListener('change', handleImport);

    // Theme toggle
    const btnThemeToggle = document.getElementById('theme-toggle');
    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const current = document.documentElement.dataset.theme || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = next;
            store.state.settings.theme = next;
            store.save();
        });
    }

    // Assets list view
    const btnViewAssets = document.querySelector('.js-view-assets');
    if (btnViewAssets) {
        btnViewAssets.addEventListener('click', () => {
            document.getElementById('dashboard').classList.add('hidden');
            document.getElementById('assets-list-view').classList.remove('hidden');
            renderAllAssets(store.state);
        });
    }

    document.addEventListener('click', (e) => {
        if (e.target.closest('.js-back-to-dashboard')) {
            document.getElementById('assets-list-view').classList.add('hidden');
            document.getElementById('dashboard').classList.remove('hidden');
        }
    });

    // Transaction actions (delegated)
    const recentEl = document.getElementById('recent-transactions');
    if (recentEl) {
        recentEl.addEventListener('click', (e) => {
            const btnEdit = e.target.closest('.js-edit-tx');
            const btnDelete = e.target.closest('.js-delete-tx');
            if (btnEdit) {
                openEditTransactionModal(btnEdit.dataset.id);
            } else if (btnDelete) {
                const id = btnDelete.dataset.id;
                openConfirmModal('Delete this transaction?', () => store.deleteTransaction(id));
            }
        });
    }

    // Asset list actions (delegated)
    const allAssetsList = document.getElementById('all-assets-list');
    if (allAssetsList) {
        allAssetsList.addEventListener('click', (e) => {
            const btnEdit = e.target.closest('.js-edit-asset');
            const btnDelete = e.target.closest('.js-delete-asset');
            if (btnEdit) {
                openEditAssetModal(btnEdit.dataset.id);
            } else if (btnDelete) {
                const id = btnDelete.dataset.id;
                openConfirmModal('Delete this asset and all its transactions?', () => {
                    store.deleteAsset(id);
                    renderAllAssets(store.state);
                });
            }
        });
    }

    // Confirm modal
    document.getElementById('confirm-cancel').addEventListener('click', closeConfirmModal);
    document.getElementById('confirm-ok').addEventListener('click', () => {
        if (_confirmCallback) _confirmCallback();
        closeConfirmModal();
    });
    document.getElementById('modal-confirm').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal-confirm')) closeConfirmModal();
    });

    // Tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Transaction Type Change
    const txTypes = document.querySelectorAll('input[name="tx-type"]');
    txTypes.forEach(radio => {
        radio.addEventListener('change', (e) => {
            handleTransactionTypeChange(e.target.value);
        });
    });

    // Form: Create / Edit Asset
    if (formAsset) {
        formAsset.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('asset-name').value;
            const category = document.getElementById('asset-category').value;

            if (editingAssetId) {
                store.editAsset(editingAssetId, { name, category });
                if (!document.getElementById('assets-list-view').classList.contains('hidden')) {
                    renderAllAssets(store.state);
                }
                closeModal();
                return;
            }

            const initialValue = document.getElementById('asset-initial-value').value;
            const initialQuantity = document.getElementById('asset-quantity').value;
            const dateInput = document.getElementById('asset-date');
            const date = dateInput && dateInput.value ? dateInput.value : new Date().toISOString();

            const newAsset = store.addAsset({ name, category, type: 'manual' });

            if ((initialValue && parseFloat(initialValue) > 0) || (initialQuantity && parseFloat(initialQuantity) > 0)) {
                store.addTransaction({
                    assetId: newAsset.id,
                    type: 'buy',
                    date: date,
                    amount: parseFloat(initialValue) || 0,
                    quantity: parseFloat(initialQuantity) || 0,
                    currentTotalValue: parseFloat(initialValue),
                    notes: 'Initial Balance'
                });
            }

            closeModal();
        });
    }

    // Form: Create Transaction
    if (formTransaction) {
        formTransaction.addEventListener('submit', (e) => {
            e.preventDefault();
            clearFieldErrors(formTransaction);
            const assetId = selectAsset.value;
            const type = document.querySelector('input[name="tx-type"]:checked').value;
            const amount = parseFloat(document.getElementById('tx-amount').value);
            const quantity = parseFloat(document.getElementById('tx-quantity').value) || 0;
            const date = document.getElementById('tx-date').value;

            let fromAssetId = null;
            if (type === 'move') {
                fromAssetId = document.getElementById('tx-from-asset').value;
                if (!fromAssetId) {
                    showFieldError(document.getElementById('tx-from-asset'), 'Select a source asset');
                    return;
                }
                if (fromAssetId === assetId) {
                    showFieldError(document.getElementById('tx-asset'), 'Source and destination must be different');
                    return;
                }
            }

            if (!assetId) {
                showFieldError(document.getElementById('tx-asset'), 'Please select an asset');
                return;
            }


            if (editingTransactionId) {
                store.editTransaction(editingTransactionId, {
                    assetId,
                    type,
                    date,
                    amount,
                    quantity,
                    fromAssetId,
                    notes: ''
                });
                editingTransactionId = null; // Reset
            } else {
                store.addTransaction({
                    assetId,
                    type,
                    date,
                    amount,
                    quantity,
                    fromAssetId, // Only used if type is 'move'
                    notes: ''
                });
            }

            closeModal();
        });
    }
};

// --- Charting ---
let netWorthChart = null;

const initChart = () => {
    const ctx = document.getElementById('history-chart');
    if (!ctx) return;

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.05)';
    Chart.defaults.font.family = "'Outfit', sans-serif";

    const history = store.getHistory('all');

    netWorthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: history.labels,
            datasets: [{
                label: 'Value',
                data: history.data,
                borderColor: '#38bdf8',
                backgroundColor: (context) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
                    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
                    gradient.addColorStop(1, 'rgba(56, 189, 248, 0)');
                    return gradient;
                },
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHitRadius: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(30, 41, 59, 0.9)',
                    titleColor: '#f8fafc',
                    bodyColor: '#38bdf8',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            return formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 5 }
                },
                y: {
                    grid: { display: true },
                    ticks: {
                        callback: function (value) {
                            return new Intl.NumberFormat('en-US', { notation: "compact" }).format(value);
                        }
                    }
                }
            }
        }
    });
};

const updateChart = (filterId = 'all') => {
    if (!netWorthChart) return;

    const history = store.getHistory(filterId);
    netWorthChart.data.labels = history.labels;
    netWorthChart.data.datasets[0].data = history.data;
    netWorthChart.update();
};

const populateChartFilter = () => {
    const filterEl = document.getElementById('chart-filter');
    if (!filterEl) return;

    const assets = store.state.assets;
    const current = filterEl.value;

    const options = ['<option value="all">All Assets</option>'];
    assets.forEach(a => {
        options.push(`<option value="${a.id}">${a.name}</option>`);
    });

    filterEl.innerHTML = options.join('');
    filterEl.value = current;
};

// --- Confirm Modal ---
let _confirmCallback = null;

const openConfirmModal = (message, onConfirm) => {
    document.getElementById('confirm-message').textContent = message;
    _confirmCallback = onConfirm;
    document.getElementById('modal-confirm').classList.remove('hidden');
};

const closeConfirmModal = () => {
    document.getElementById('modal-confirm').classList.add('hidden');
    _confirmCallback = null;
};

// --- Edit Logic ---
let editingTransactionId = null;
let editingAssetId = null;

const openEditAssetModal = (id) => {
    const asset = store.state.assets.find(a => a.id === id);
    if (!asset) return;
    editingAssetId = id;
    openModal();
    switchTab('tab-asset');
    document.getElementById('asset-name').value = asset.name;
    document.getElementById('asset-category').value = asset.category;
    ['asset-initial-value', 'asset-quantity', 'asset-date'].forEach(fId => {
        const el = document.getElementById(fId);
        if (el) el.closest('.form-group').classList.add('hidden');
    });
    const btnSubmit = formAsset.querySelector('button[type="submit"]');
    if (btnSubmit) btnSubmit.textContent = 'Update Asset';
};

const openEditTransactionModal = (id) => {
    const tx = store.state.transactions.find(t => t.id === id);
    if (!tx) return;

    editingTransactionId = id;
    openModal();

    // Switch to transaction tab
    switchTab('tab-transaction');

    // Fill Form
    const selectAsset = document.getElementById('tx-asset');
    selectAsset.value = tx.assetId;

    // Set Radio
    const radio = document.querySelector(`input[name="tx-type"][value="${tx.type}"]`);
    if (radio) {
        radio.checked = true;
        handleTransactionTypeChange(tx.type);
    }

    document.getElementById('tx-amount').value = tx.amount;
    document.getElementById('tx-quantity').value = tx.quantity || 0;

    // Handle Date (extract YYYY-MM-DD)
    const dateStr = new Date(tx.date).toISOString().split('T')[0];
    document.getElementById('tx-date').value = dateStr;

    if (tx.type === 'move' && tx.fromAssetId) {
        const fromSelect = document.getElementById('tx-from-asset');
        if (fromSelect) fromSelect.value = tx.fromAssetId;
    }

    // Update Button Text
    const btnSubmit = formTransaction.querySelector('button[type="submit"]');
    if (btnSubmit) btnSubmit.textContent = 'Update Transaction';
};

// --- Category Treemap ---
const CATEGORY_COLORS = ['#38bdf8', '#818cf8', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#fb923c'];
let categoryChart = null;

const getCategoryData = () =>
    Object.entries(
        store.state.assets.filter(a => a.currentValue > 0).reduce((acc, a) => {
            acc[a.category] = (acc[a.category] || 0) + a.currentValue;
            return acc;
        }, {})
    ).map(([g, v]) => ({ g, v }));

const initCategoryChart = () => {
    const ctx = document.getElementById('category-chart');
    if (!ctx) return;
    const treeData = getCategoryData();
    categoryChart = new Chart(ctx, {
        type: 'treemap',
        data: {
            datasets: [{
                tree: treeData,
                key: 'v',
                groups: ['g'],
                borderWidth: 2,
                borderColor: 'var(--bg-body)',
                backgroundColor: (ctx) => {
                    if (ctx.type !== 'data') return 'transparent';
                    return CATEGORY_COLORS[ctx.dataIndex % CATEGORY_COLORS.length];
                },
                labels: {
                    display: true,
                    formatter: (ctx) => [ctx.raw._data.g, formatCurrency(ctx.raw.v)],
                    color: 'rgba(255,255,255,0.9)',
                    font: [
                        { weight: '600', size: 12, family: "'Outfit', sans-serif" },
                        { size: 11, family: "'Outfit', sans-serif" }
                    ]
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: () => '',
                        label: (ctx) => ` ${ctx.raw._data.g}: ${formatCurrency(ctx.raw.v)}`
                    }
                }
            }
        }
    });
    document.getElementById('category-chart-container').style.display = treeData.length ? '' : 'none';
};

const updateCategoryChart = () => {
    if (!categoryChart) return;
    const treeData = getCategoryData();
    categoryChart.data.datasets[0].tree = treeData;
    categoryChart.update();
    document.getElementById('category-chart-container').style.display = treeData.length ? '' : 'none';
};

const renderAllAssets = (state) => {
    const container = document.getElementById('all-assets-list');
    if (!container) return;
    if (!state.assets.length) {
        container.innerHTML = '<div class="empty-state">No assets yet.</div>';
        return;
    }
    const sorted = [...state.assets].sort((a, b) => b.currentValue - a.currentValue);
    container.innerHTML = sorted.map(renderAssetListItem).join('');
};

const init = () => {
    console.log('Initializing App...');
    // Initial Render
    renderDashboard(store.state);
    populateChartFilter();
    initChart();
    initCategoryChart();

    // Subscribe to store updates
    store.subscribe((state) => {
        renderDashboard(state);
        populateChartFilter();
        const currentFilter = document.getElementById('chart-filter').value;
        updateChart(currentFilter);
        updateCategoryChart();
    });

    setupEventListeners();

    // Chart Filter Listener
    const chartFilter = document.getElementById('chart-filter');
    if (chartFilter) {
        chartFilter.addEventListener('change', (e) => {
            updateChart(e.target.value);
        });
    }

    // Apply saved theme
    document.documentElement.dataset.theme = store.state.settings.theme || 'dark';

    console.log('App Initialized');
};

// --- Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('SW registered:', registration);
            })
            .catch(error => {
                console.log('SW registration failed:', error);
            });
    });
}

document.addEventListener('DOMContentLoaded', init);
