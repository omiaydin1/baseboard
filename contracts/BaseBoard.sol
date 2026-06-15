// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title BaseBoard
 * @notice A 3162 x 3162 grid (≈10,000,000 plots) marketplace on Base Mainnet.
 *         Each plot is sold for a flat primary price of 0.00005 ETH which is
 *         routed in full to the treasury. Owners can list plots for sale on a
 *         secondary market, update their price, attach an image URI, and accept
 *         escrowed offers from other users.
 *
 * @dev Storage is intentionally sparse: plots live in a `mapping(uint256 => Plot)`
 *      rather than a fixed-length array so the contract never iterates over the
 *      full 10M id-space. Coordinates are serialized as `plotId = (y * 3162) + x`.
 */
contract BaseBoard {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Width / height of the square grid.
    uint256 public constant GRID_SIZE = 3162;

    /// @notice Maximum number of addressable plots (3162 * 3162 = 9,998,244).
    uint256 public constant MAX_PLOTS = GRID_SIZE * GRID_SIZE;

    /// @notice Flat primary mint price per plot (set at deploy time, native
    ///         units). Base: 0.00005 ETH. Celo: 1.3 CELO.
    uint256 public immutable PLOT_PRICE;

    /// @notice Treasury that receives 100% of primary purchase proceeds
    ///         (set at deploy time).
    address payable public immutable TREASURY;

    /**
     * @param plotPrice Flat primary mint price per plot, in native wei.
     * @param treasury  Address that receives 100% of primary sale proceeds.
     */
    constructor(uint256 plotPrice, address payable treasury) {
        require(plotPrice > 0, "Price must be > 0");
        require(treasury != address(0), "Treasury required");
        PLOT_PRICE = plotPrice;
        TREASURY = treasury;
    }

    // ---------------------------------------------------------------------
    // Types & storage
    // ---------------------------------------------------------------------

    struct Plot {
        address owner;
        uint256 price;
        bool isForSale;
        string imageUri;
    }

    /// @notice Plot state keyed by serialized plot id. Default (zero) entries
    ///         represent unowned, unminted plots.
    mapping(uint256 => Plot) public plots;

    /// @notice Total number of plots that have been minted (primary sales).
    uint256 public totalPlotsSold;

    /// @notice Escrowed offer amount: offers[plotId][bidder] => wei.
    mapping(uint256 => mapping(address => uint256)) public offers;

    /// @dev Enumeration of plots owned by an address (for the profile view).
    mapping(address => uint256[]) private _ownedPlots;
    /// @dev plotId => index within its owner's `_ownedPlots` array.
    mapping(uint256 => uint256) private _ownedIndex;

    /// @dev Minimal non-reentrancy guard.
    uint256 private _locked = 1;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PlotsPurchased(address indexed buyer, uint256[] plotIds, uint256 totalPaid);
    event PlotSold(uint256 indexed plotId, address indexed seller, address indexed buyer, uint256 price);
    event PlotListed(uint256 indexed plotId, address indexed owner, uint256 price);
    event ListingCancelled(uint256 indexed plotId, address indexed owner);
    event PriceUpdated(uint256 indexed plotId, address indexed owner, uint256 newPrice);
    event OfferPlaced(uint256 indexed plotId, address indexed offeror, uint256 amount);
    event OfferAccepted(uint256 indexed plotId, address indexed seller, address indexed offeror, uint256 amount);
    event OfferCancelled(uint256 indexed plotId, address indexed offeror, uint256 amount);
    event ImageUpdated(uint256 indexed plotId, address indexed owner, string imageUri);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier nonReentrant() {
        require(_locked == 1, "Reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyPlotOwner(uint256 plotId) {
        require(plots[plotId].owner == msg.sender, "Not plot owner");
        _;
    }

    // ---------------------------------------------------------------------
    // Primary market
    // ---------------------------------------------------------------------

    /**
     * @notice Buy one or more currently-unowned plots at the flat primary price.
     *         Requires `msg.value == plotIds.length * PLOT_PRICE`. All proceeds
     *         are forwarded to the treasury.
     */
    function buyPlots(uint256[] calldata plotIds) external payable nonReentrant {
        uint256 count = plotIds.length;
        require(count > 0, "No plots");
        require(msg.value == count * PLOT_PRICE, "Incorrect ETH");

        for (uint256 i = 0; i < count; i++) {
            uint256 id = plotIds[i];
            require(id < MAX_PLOTS, "Invalid plot id");
            Plot storage p = plots[id];
            require(p.owner == address(0), "Plot already owned");
            p.owner = msg.sender;
            _addOwned(msg.sender, id);
        }

        totalPlotsSold += count;
        emit PlotsPurchased(msg.sender, plotIds, msg.value);

        (bool ok, ) = TREASURY.call{value: msg.value}("");
        require(ok, "Treasury transfer failed");
    }

    // ---------------------------------------------------------------------
    // Secondary market (listings)
    // ---------------------------------------------------------------------

    /// @notice List an owned plot for sale at `price` wei.
    function listPlot(uint256 plotId, uint256 price) external onlyPlotOwner(plotId) {
        require(price > 0, "Price must be > 0");
        Plot storage p = plots[plotId];
        p.isForSale = true;
        p.price = price;
        emit PlotListed(plotId, msg.sender, price);
    }

    /// @notice Remove an owned plot from the marketplace.
    function cancelListing(uint256 plotId) external onlyPlotOwner(plotId) {
        Plot storage p = plots[plotId];
        require(p.isForSale, "Not listed");
        p.isForSale = false;
        p.price = 0;
        emit ListingCancelled(plotId, msg.sender);
    }

    /// @notice Update the asking price of an actively listed plot.
    function updatePlotPrice(uint256 plotId, uint256 newPrice) external onlyPlotOwner(plotId) {
        require(newPrice > 0, "Price must be > 0");
        Plot storage p = plots[plotId];
        require(p.isForSale, "Not listed");
        p.price = newPrice;
        emit PriceUpdated(plotId, msg.sender, newPrice);
    }

    /**
     * @notice Buy a plot that its owner has listed for sale. Payment goes to the
     *         seller (secondary sale), not the treasury.
     * @dev Not in the original "essential" list, but required to fulfil the
     *      "Buy Now" checkout on listed plots in the UI.
     */
    function buyListedPlot(uint256 plotId) external payable nonReentrant {
        Plot storage p = plots[plotId];
        address seller = p.owner;
        require(seller != address(0), "Plot not owned");
        require(p.isForSale, "Not for sale");
        require(seller != msg.sender, "Already owner");
        require(msg.value == p.price, "Incorrect ETH");

        _transfer(seller, msg.sender, plotId);
        emit PlotSold(plotId, seller, msg.sender, msg.value);

        (bool ok, ) = payable(seller).call{value: msg.value}("");
        require(ok, "Seller transfer failed");
    }

    // ---------------------------------------------------------------------
    // Offers (escrowed bids)
    // ---------------------------------------------------------------------

    /// @notice Escrow an offer on any owned plot. Multiple calls accumulate.
    function placeOffer(uint256 plotId) external payable {
        require(msg.value > 0, "Zero offer");
        require(plots[plotId].owner != address(0), "Plot not owned");
        require(plots[plotId].owner != msg.sender, "Owner cannot offer");
        offers[plotId][msg.sender] += msg.value;
        emit OfferPlaced(plotId, msg.sender, offers[plotId][msg.sender]);
    }

    /// @notice Plot owner accepts an offeror's escrowed bid, transferring the plot.
    function acceptOffer(uint256 plotId, address offeror)
        external
        onlyPlotOwner(plotId)
        nonReentrant
    {
        uint256 amount = offers[plotId][offeror];
        require(amount > 0, "No such offer");
        require(offeror != msg.sender, "Cannot accept own offer");

        offers[plotId][offeror] = 0;
        address seller = msg.sender;
        _transfer(seller, offeror, plotId);
        emit OfferAccepted(plotId, seller, offeror, amount);

        (bool ok, ) = payable(seller).call{value: amount}("");
        require(ok, "Settlement failed");
    }

    /// @notice Withdraw your own escrowed offer on a plot.
    function cancelOffer(uint256 plotId) external nonReentrant {
        uint256 amount = offers[plotId][msg.sender];
        require(amount > 0, "No offer");
        offers[plotId][msg.sender] = 0;
        emit OfferCancelled(plotId, msg.sender, amount);

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Refund failed");
    }

    // ---------------------------------------------------------------------
    // Image metadata
    // ---------------------------------------------------------------------

    /// @notice Attach / update the image URI rendered on a plot.
    function updatePlotImage(uint256 plotId, string calldata imageUri)
        external
        onlyPlotOwner(plotId)
    {
        plots[plotId].imageUri = imageUri;
        emit ImageUpdated(plotId, msg.sender, imageUri);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Remaining unminted plots.
    function remainingPlots() external view returns (uint256) {
        return MAX_PLOTS - totalPlotsSold;
    }

    /// @notice Convenience accessor returning a full Plot struct.
    function getPlot(uint256 plotId) external view returns (Plot memory) {
        return plots[plotId];
    }

    /// @notice Batch-fetch plot structs for the visible viewport.
    function getPlotsBatch(uint256[] calldata plotIds) external view returns (Plot[] memory) {
        Plot[] memory result = new Plot[](plotIds.length);
        for (uint256 i = 0; i < plotIds.length; i++) {
            result[i] = plots[plotIds[i]];
        }
        return result;
    }

    /// @notice All plot ids currently owned by `account`.
    function getPlotsByOwner(address account) external view returns (uint256[] memory) {
        return _ownedPlots[account];
    }

    /// @notice Number of plots owned by `account`.
    function balanceOf(address account) external view returns (uint256) {
        return _ownedPlots[account].length;
    }

    /// @notice Serialize (x, y) -> plotId.
    function coordsToPlotId(uint256 x, uint256 y) external pure returns (uint256) {
        require(x < GRID_SIZE && y < GRID_SIZE, "Out of bounds");
        return (y * GRID_SIZE) + x;
    }

    /// @notice Deserialize plotId -> (x, y).
    function plotIdToCoords(uint256 plotId) external pure returns (uint256 x, uint256 y) {
        require(plotId < MAX_PLOTS, "Out of bounds");
        x = plotId % GRID_SIZE;
        y = plotId / GRID_SIZE;
    }

    // ---------------------------------------------------------------------
    // Internal enumeration helpers
    // ---------------------------------------------------------------------

    function _addOwned(address to, uint256 id) internal {
        _ownedIndex[id] = _ownedPlots[to].length;
        _ownedPlots[to].push(id);
    }

    function _removeOwned(address from, uint256 id) internal {
        uint256 idx = _ownedIndex[id];
        uint256 lastIdx = _ownedPlots[from].length - 1;
        if (idx != lastIdx) {
            uint256 lastId = _ownedPlots[from][lastIdx];
            _ownedPlots[from][idx] = lastId;
            _ownedIndex[lastId] = idx;
        }
        _ownedPlots[from].pop();
        delete _ownedIndex[id];
    }

    function _transfer(address from, address to, uint256 id) internal {
        _removeOwned(from, id);
        Plot storage p = plots[id];
        p.owner = to;
        p.isForSale = false;
        p.price = 0;
        _addOwned(to, id);
    }
}
