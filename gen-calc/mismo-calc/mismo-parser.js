/**
 * MISMO 3.4 XML Parser
 * Extracts borrower, employment, and income data from MISMO XML files
 * 
 * File: mismo-parser.js
 * Used by: MISMO_Document_Analyzer.html
 */

const NS = 'http://www.mismo.org/residential/2009/schemas';

// Utility: Get first matching element
function first(el, name) {
    const items = el.getElementsByTagNameNS(NS, name);
    return items.length > 0 ? items[0] : null;
}

// Utility: Get all matching elements
function all(el, name) {
    return Array.from(el.getElementsByTagNameNS(NS, name));
}

// Utility: Get text content
function textOf(el) {
    return el ? (el.textContent || '').trim() : '';
}

// Utility: Parse date string to Date object
function parseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

// Utility: Calculate months between two dates
function monthsBetween(start, end) {
    if (!start || !end) return null;
    const years = end.getFullYear() - start.getFullYear();
    const months = end.getMonth() - start.getMonth();
    return years * 12 + months;
}

/**
 * Main parser function
 * @param {Document} doc - Parsed XML document
 * @returns {Object} Structured MISMO data
 */
function parseMISMO(doc) {
    const data = {
        borrowers: [],
        loanPurpose: null,
        mortgageType: null,
        baseLoanAmount: null,
        assets: [],
        liabilities: [],
        reoProperties: [],
        hasHOA: false
    };

    // Extract loan terms
    const terms = first(doc, 'TERMS_OF_LOAN');
    if (terms) {
        data.baseLoanAmount = textOf(first(terms, 'BaseLoanAmount')) || null;
        data.loanPurpose = textOf(first(terms, 'LoanPurposeType')) || null;
        data.mortgageType = textOf(first(terms, 'MortgageType')) || null;
    }

    // Extract borrower names from INDIVIDUAL elements
    const individuals = all(doc, 'INDIVIDUAL');
    const individualNames = individuals.map(ind => {
        const nm = first(ind, 'NAME');
        if (!nm) return 'Borrower';
        const fullName = textOf(first(nm, 'FullName'));
        if (fullName) return fullName;
        const firstName = textOf(first(nm, 'FirstName'));
        const lastName = textOf(first(nm, 'LastName'));
        return `${firstName} ${lastName}`.trim() || 'Borrower';
    });

    // Extract borrowers
    const borrowerElements = all(doc, 'BORROWER');
    borrowerElements.forEach((bEl, index) => {
        const borrower = {
            name: individualNames[index] || `Borrower #${index + 1}`,
            incomes: [],
            employments: [],
            residences: [],
            declarations: {
                usCitizen: null,
                permResident: null,
                nonPermResident: null,
                bankruptcy: false,
                foreclosure: false,
                judgments: false
            }
        };

        // Extract income information
        const currentIncome = first(bEl, 'CURRENT_INCOME');
        if (currentIncome) {
            const incomeItems = first(currentIncome, 'CURRENT_INCOME_ITEMS');
            if (incomeItems) {
                all(incomeItems, 'CURRENT_INCOME_ITEM').forEach(item => {
                    const detail = first(item, 'CURRENT_INCOME_ITEM_DETAIL');
                    if (!detail) return;

                    const incomeType = textOf(first(detail, 'IncomeType'));
                    const monthlyAmount = textOf(first(detail, 'CurrentIncomeMonthlyTotalAmount'));
                    const isEmploymentIncome = textOf(first(detail, 'EmploymentIncomeIndicator')) === 'true';

                    borrower.incomes.push({
                        type: incomeType,
                        monthlyAmount: monthlyAmount ? parseFloat(monthlyAmount) : 0,
                        isEmploymentIncome: isEmploymentIncome
                    });
                });
            }
        }

        // Extract employment information
        const employers = first(bEl, 'EMPLOYERS');
        if (employers) {
            const now = new Date();
            all(employers, 'EMPLOYER').forEach(emp => {
                const empNode = first(emp, 'EMPLOYMENT');
                if (!empNode) return;

                const startDate = parseDate(textOf(first(empNode, 'EmploymentStartDate')));
                const endDateText = textOf(first(empNode, 'EmploymentEndDate'));
                const endDate = endDateText ? parseDate(endDateText) : now;
                const monthsEmployed = monthsBetween(startDate, endDate);

                const isSelfEmployed = textOf(first(empNode, 'EmploymentBorrowerSelfEmployedIndicator')) === 'true';
                const classificationType = textOf(first(empNode, 'EmploymentClassificationType'));
                
                // Try multiple field names for ownership percentage
                let ownershipPercent = null;
                const ownershipFields = [
                    'EmploymentOwnershipInterestPercent',
                    'OwnershipInterestPercent',
                    'OwnershipPercent',
                    'OwnershipPercentage'
                ];
                for (const fieldName of ownershipFields) {
                    const value = textOf(first(empNode, fieldName));
                    if (value) {
                        ownershipPercent = parseFloat(value);
                        if (!isNaN(ownershipPercent)) break;
                    }
                }

                const employerName = textOf(first(empNode, 'EmployerName')) || 
                                    textOf(first(emp, 'Name')) || 
                                    textOf(first(emp, 'LegalEntityName')) || 
                                    'Employer';

                borrower.employments.push({
                    employerName: employerName,
                    startDate: startDate,
                    endDate: endDate,
                    monthsEmployed: monthsEmployed,
                    isSelfEmployed: isSelfEmployed,
                    classificationType: classificationType,
                    ownershipPercent: ownershipPercent,
                    // Detect entity types from classification
                    isSCorp: (classificationType || '').match(/s-?corp|s\s*corporation/i) !== null,
                    isPartnership: (classificationType || '').match(/partnership/i) !== null,
                    is1120: (classificationType || '').match(/1120/i) !== null,
                    is1065: (classificationType || '').match(/1065/i) !== null
                });
            });
        }

        // Extract residence history
        const residences = first(bEl, 'RESIDENCES');
        if (residences) {
            all(residences, 'RESIDENCE').forEach(res => {
                const detail = first(res, 'RESIDENCE_DETAIL');
                if (!detail) return;

                const monthsAtResidence = parseInt(textOf(first(detail, 'BorrowerResidencyDurationMonthsCount'))) || 0;
                const residencyType = textOf(first(detail, 'BorrowerResidencyType'));

                borrower.residences.push({
                    monthsAtResidence: monthsAtResidence,
                    residencyType: residencyType
                });
            });
        }

        // Extract declarations
        const decl = first(bEl, 'DECLARATION') || bEl;
        const declDetail = first(decl, 'DECLARATION_DETAIL') || decl;
        
        const getBool = (fieldName) => {
            const value = textOf(first(declDetail, fieldName));
            if (value === '') return null;
            return value === 'true';
        };

        borrower.declarations.usCitizen = getBool('USCitizenIndicator');
        borrower.declarations.permResident = getBool('PermanentResidentAlienIndicator');
        borrower.declarations.nonPermResident = getBool('NonPermanentResidentAlienIndicator');
        borrower.declarations.bankruptcy = getBool('BankruptcyIndicator') || 
                                          getBool('BorrowerHadBankruptcyIndicator') || false;
        borrower.declarations.foreclosure = getBool('PropertyForeclosureIndicator') || 
                                           getBool('BorrowerHadPropertyForeclosedIndicator') || false;
        borrower.declarations.judgments = getBool('OutstandingJudgmentsIndicator') || false;

        data.borrowers.push(borrower);
    });

    // Extract assets
    all(doc, 'ASSET').forEach(asset => {
        const detail = first(asset, 'ASSET_DETAIL');
        if (!detail) return;

        data.assets.push({
            type: textOf(first(detail, 'AssetType')),
            holderName: textOf(first(detail, 'HolderName')),
            accountIdentifier: textOf(first(detail, 'AccountIdentifier')),
            amount: textOf(first(detail, 'AssetCashOrMarketValueAmount'))
        });
    });

    // Extract liabilities
    all(doc, 'LIABILITY').forEach(liability => {
        const detail = first(liability, 'LIABILITY_DETAIL');
        if (!detail) return;

        const liabilityType = textOf(first(detail, 'LiabilityType'));
        const payoffAtClosing = textOf(first(detail, 'PayoffIncludedInClosingIndicator')) === 'true';

        data.liabilities.push({
            type: liabilityType,
            toBePaidAtClosing: payoffAtClosing,
            accountIdentifier: textOf(first(detail, 'AccountIdentifier'))
        });
    });

    // Extract REO properties
    const reoElements = all(doc, 'REO_PROPERTY');
    reoElements.forEach(reo => {
        const propNode = first(reo, 'PROPERTY');
        const addr = (propNode && first(propNode, 'ADDRESS')) || first(reo, 'ADDRESS');
        
        const addressLine = addr ? (textOf(first(addr, 'AddressLineText')) || 
                                    textOf(first(addr, 'AddressLine1Text'))) : '';
        const city = addr ? textOf(first(addr, 'CityName')) : '';
        const state = addr ? textOf(first(addr, 'StateCode')) : '';
        
        const usageNode = first(reo, 'PropertyUsageType') || 
                         (propNode && first(propNode, 'PropertyUsageType'));
        const usage = usageNode ? textOf(usageNode) : '';

        data.reoProperties.push({
            address: [addressLine, city && state ? `${city}, ${state}` : (city || state)].filter(Boolean).join(' '),
            usage: usage
        });
    });

    // Check for HOA
    all(doc, 'HOUSING_EXPENSE').forEach(expense => {
        const expenseType = textOf(first(expense, 'HousingExpenseType'));
        if ((expenseType || '').match(/association|hoa/i)) {
            data.hasHOA = true;
        }
    });

    const propDetail = first(doc, 'PROPERTY_DETAIL');
    if (propDetail) {
        const isPUD = textOf(first(propDetail, 'PUDIndicator')) === 'true';
        if (isPUD) data.hasHOA = true;
    }

    return data;
}

/**
 * Calculate employment coverage metrics for a borrower
 * @param {Object} borrower - Borrower object from parseMISMO
 * @returns {Object} Coverage metrics
 */
function calculateEmploymentCoverage(borrower) {
    const totalMonths = borrower.employments.reduce((sum, emp) => 
        sum + (emp.monthsEmployed || 0), 0);
    
    return {
        totalMonths: totalMonths,
        monthsNeeded: Math.max(0, 24 - totalMonths),
        isSufficient: totalMonths >= 24
    };
}

/**
 * Calculate residence coverage metrics for a borrower
 * @param {Object} borrower - Borrower object from parseMISMO
 * @returns {Object} Coverage metrics
 */
function calculateResidenceCoverage(borrower) {
    const totalMonths = borrower.residences.reduce((sum, res) => 
        sum + (res.monthsAtResidence || 0), 0);
    
    return {
        totalMonths: totalMonths,
        monthsNeeded: Math.max(0, 24 - totalMonths),
        isSufficient: totalMonths >= 24
    };
}

// Export functions for use in HTML
if (typeof window !== 'undefined') {
    window.MISMOParser = {
        parseMISMO,
        calculateEmploymentCoverage,
        calculateResidenceCoverage
    };
}
