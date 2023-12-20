const stats = require('./spdb');
const attackDie = ['critical', 'hit', 'hit', 'hit', 'expertise', 'expertise', 'fail', 'fail'];
const blockDie = ['block', 'fail', 'expertise'];
const drawLimit = 2;
const drawValue = 0.5;
let verbose = false;
const range = [0, 25, 76, 152, 203, 254];
const bases = {
    small: 40,
    medium: 50
};
let iterations = 1000;
const movement = {
    dash: 86,
    advance: 150
};

const verboseLog = (line) => {
    if (verbose) {
        console.log(line);
    }
}

const rollDie = (dieType) => dieType[Math.floor(Math.random() * dieType.length)];


const makeAttack = (dice, expertiseChart = [[]], rerollFailures = 0) => {
    const results = {
        hit: 0,
        critical: 0,
        damage: 0,
        heal: 0,
        fail: 0,
        shove: 0
    };
    let expertise = 0;
    let rerolls = rerollFailures;
    for (let d = 0; d < dice; d++) {
        const result = rollDie(attackDie);
        switch (result) {
            case 'expertise':
                expertise++;
                break;
            case 'hit':
            case 'critical':
            case 'heal':
                results[result]++;
                break;
            case 'fail':
                if (rerolls > 0) {
                    d--;
                    rerolls--;
                } else {
                    results.fail++;
                }
            default:
                break;
        }
    }
    if (expertise >= expertiseChart.length) {
        expertise = expertiseChart.length - 1;
    }
    expertiseChart[expertise].forEach((expBonus) => {
        results[expBonus]++;
    });
    return results;
};

const makeDefense = (dice, expertiseChart = [[]], automaticBlocks = 0, automaticExpertise = 0) => {
    const results = {
        block: automaticBlocks,
        crittohit: 0,
        crittofail: 0,
        hittofail: 0,
        heal: 0,
        advance: 0,
        dash: 0
    };
    let expertise = automaticExpertise;
    for (let d = 0; d < dice; d++) {
        const result = rollDie(blockDie);
        switch (result) {
            case 'expertise':
                expertise++;
                break;
            case 'block':
                results[result]++;
                break;
            default:
                break;
        }
    }
    if (expertise >= expertiseChart.length) {
        expertise = expertiseChart.length - 1;
    }
    expertiseChart[expertise].forEach((expBonus) => {
        results[expBonus]++;
    });
    return results;
};

const resolveNet = (attackResult, blockResult) => {
    for (let ctf = 0; ctf < blockResult.crittofail; ctf++) {
        if (attackResult.critical > 0) {
            attackResult.critical--;
            attackResult.fail++;
        }
    }
    for (let cth = 0; cth < blockResult.crittohit; cth++) {
        if (attackResult.critical > 0) {
            attackResult.critical--;
            attackResult.hit++;
        }
    }
    for (let htf = 0; htf < blockResult.hittofail; htf++) {
        if (attackResult.hit > 0) {
            attackResult.hit--;
            attackResult.fail++;
        }
    }
    attackResult.hit = Math.max(0, attackResult.hit - blockResult.block);
    return {
        successes: attackResult.hit + attackResult.critical,
        attackerFailures: attackResult.fail,
        damage: attackResult.damage,
        defenderHeal: blockResult.heal,
        defenderAdvance: blockResult.advance,
        defenderDash: blockResult.dash
    }
};

const letsFight = (one, two) => {
    let oneHealth = one.health;
    let twoHealth = two.health;
    let oneAttackDice = one.attack;
    let twoAttackDice = two.attack;
    if (one.bonus) {
        oneAttackDice += Math.floor((one.health - oneHealth) / 3);
    }
    if (two.bonus) {
        twoAttackDice += Math.floor((two.health - twoHealth) / 3);
    }
    const oneAttackRoll = () => {
        if (one.healthcost) {
            oneHealth -= one.healthcost;
        }
        const oneAttack = resolveNet(makeAttack(oneAttackDice, one.attackExpertise), makeDefense(two.defense, two.defenseExpertise));
        if (oneAttack.successes >= one.damageTrack.length) {
            oneAttack.successes = one.damageTrack.length - 1;
        }
        twoHealth -= Math.max((one.damageTrack[oneAttack.successes] + oneAttack.damage - (two.protection ? 1 : 0)), 0);
        if (twoHealth > 0) {
            twoHealth += oneAttack.defenderHeal;
        }
        if (one.healTrack) {
            oneHealth += one.healTrack[oneAttack.successes];
        }
    };
    const twoAttackRoll = () => {
        if (two.healthcost) {
            twoHealth -= two.healthcost;
        }
        const twoAttack = resolveNet(makeAttack(twoAttackDice, two.attackExpertise), makeDefense(one.defense, one.defenseExpertise));
        if (twoAttack.successes >= two.damageTrack.length) {
            twoAttack.successes = two.damageTrack.length - 1;
        }
        oneHealth -= Math.max((two.damageTrack[twoAttack.successes] + twoAttack.damage - (one.protection ? 1 : 0)), 0);
        if (oneHealth > 0) {
            oneHealth += twoAttack.defenderHeal;
        }
        if (two.healTrack) {
            twoHealth += two.healTrack[twoAttack.successes];;
        }
    };
    let roundCounter = 0;
    while (oneHealth > 0 && twoHealth > 0) {
        if (one.attacks) {
            for (let a = 0; a < one.attacks; a++) {
                oneAttackRoll();
            }
        } else {
            oneAttackRoll();
        }
        if (two.attacks) {
            for (let a = 0; a < two.attacks; a++) {
                twoAttackRoll();
            }
        } else {
            twoAttackRoll();
        }
        roundCounter++;
    }
    if (roundCounter > drawLimit) {
        return 0;
    }
    if (oneHealth <= 0 && twoHealth <= 0) {
        return 0;
    }
    if (oneHealth <= 0) {
        return 2;
    }
    if (twoHealth <= 0) {
        return 1;
    }
};

const showdown = (attacker, defender, reportCallback, trackSuccesses) => {
    let distance = Math.max(attacker.range, defender.range) + 1;
    let turnCounter = 0;
    let countSuccesses = 0;
    const attackerStats = {
        ...attacker,
        maxHealth: attacker.health,
        exposed: false,
        pinned: false,
        disarmed: false,
        strained: false,
        hunker: 0,
        focused: false,
        damageDealt: 0,
        turns: 0
    };
    const defenderStats = {
        ...defender,
        maxHealth: defender.health,
        exposed: false,
        pinned: false,
        disarmed: false,
        strained: false,
        hunker: 0,
        focused: false,
        damageDealt: 0,
        turns: 0
    };
    const handleMove = (mover, moveDistance, towards, mandatory) => {
        if (mover.pinned) {
            mover.pinned = false;
            return 1;
        }
        if (mover.strained && (moveDistance === movement.advance || moveDistance === movement.dash)) {
            if (mover.health > 3 || mandatory) {
                handleDamage(mover, 3);
                mover.strained = false;
            } else {
                return 0;
            }
        }
        moveDistance += mover.baseSize;
        if (towards) {
            if (mandatory) {
                distance = Math.max(0, distance - moveDistance);
            } else {
                distance = Math.max(mover.range, distance - moveDistance);
            }
        } else {
            if (distance > mover.range || mandatory) {
                distance = distance + moveDistance;
            } else {
                distance = Math.min(mover.range, distance + moveDistance);
            }
        }
        return 1;
    };
    const handleDamage = (character, damage) => {
        if (character.divinity && character.health === character.maxHealth) {
            character.health -= Math.ceil(damage / 2);
        } else {
            character.health -= damage;
        }
    }
    const handleTurn = (actor, reactor) => {
        verboseLog(`Start of turn, distance is ${distance}`)
        let actions = 2;
        let plan = actor.plan;
        let freeAttacks = 0;
        let enemyPlan = reactor.plan;
        let performedFreeMove = 0;
        let impact = (actor.firstTurnImpact && turnCounter === 0) ? actor.firstTurnImpact : actor.impact;
        actor.hunker = 0;
        if (actor.alwaysExposed && !reactor.exposedImmune) {
            reactor.exposed = true;
        }
        if (actor.freeHeal) {
            actor.health = Math.min(actor.maxHealth, actor.health + 1);
        }
        if (plan === 'balanced') {
            if (enemyPlan === 'melee') {
                plan = 'ranged';
            } else if (enemyPlan === 'ranged') {
                plan = 'melee';
            } else {
                plan = 'balanced';
            }
        }
        if (enemyPlan === 'balanced') {
            if (plan === 'melee') {
                enemyPlan = 'ranged';
            } else if (plan === 'ranged') {
                enemyPlan = 'melee';
            } else {
                plan = 'balanced';
            }
        }
        if (reactor.notSoFast) {
            const nsfResult = makeAttack(reactor.notSoFast);
            handleDamage(actor, nsfResult.successes);
            verboseLog(`Not So Fast deals ${nsfResult.successes} damage`);
        }
        const handleAttack = (attackOverride) => {
            let attacks = actor.attacks || 1;
            for (let a = 0; a < attacks && actor.health > 0 && reactor.health > 0; a++) {
                let attackResult;
                let defenseResult;
                let isMelee = false;
                if (distance <= range[2]) {
                    verboseLog('I am making a melee attack')
                    isMelee = true;
                    let attackDice = attackOverride || actor.meleeAttack;
                    verboseLog(`I am attacking with ${attackDice} dice`)
                    if (actor.damagePerBonusDice) {
                        const damageTokens = actor.maxHealth - actor.health;
                        attackDice = attackDice + Math.floor(damageTokens / actor.damagePerBonusDice);
                    }
                    if (actor.primaryBonus && reactor.isPrimary) {
                        attackDice += actor.primaryBonus;
                    }
                    if (actor.hatred) {
                        if (actor.health > actor.hatred.cost) {
                            handleDamage(actor, actor.hatred.cost);
                            attackDice += actor.hatred.bonus;
                        }
                    }
                    if (actor.focused) {
                        attackDice++;
                        if (impact) {
                            attackDice += impact;
                        }
                    }
                    if (performedFreeMove && actor.diceFromFreeMove) {
                        attackDice += actor.diceFromFreeMove;
                    }
                    let defenseDice = reactor.meleeDefense;
                    if (reactor.hunkerOnMeleeDefense) {
                        reactor.hunker += hunkerOnMeleeDefense;
                    }
                    if (reactor.bonusDefense && reactor.health >= reactor.bonusDefense.health) {
                        defenseDice += reactor.bonusDefense.bonus;
                    }
                    if (reactor.hunker) {
                        if (reactor.hunkerMelee) {
                            defenseDice += reactor.hunkerMelee;
                        }
                    }
                    attackResult = makeAttack(attackDice, actor.disarmed ? [[]] : actor.meleeExpertise, actor.rerollFailures);
                    defenseResult = makeDefense(defenseDice, reactor.exposed ? [[]] : reactor.defenseExpertise, reactor.automaticBlocks);
                    verboseLog(attackResult)
                    verboseLog(defenseResult)
                } else if (distance <= actor.range) {
                    verboseLog('I am making a ranged attack')
                    let attackDice = attackOverride || actor.rangedAttack;
                    verboseLog(`I am attacking with ${attackDice} dice`)
                    if (actor.focused) {
                        attackDice++;
                        if (actor.sharpshooter) {
                            attackDice += actor.sharpshooter;
                        }
                    }
                    if (performedFreeMove && actor.diceFromFreeMove) {
                        attackDice += actor.diceFromFreeMove;
                    }
                    if (actor.primaryBonus && reactor.isPrimary) {
                        attackDice += actor.primaryBonus;
                    }
                    let defenseDice = reactor.rangedDefense;
                    if (reactor.hunkerOnRangedDefense) {
                        reactor.hunker += reactor.hunkerOnRangedDefense;
                    }
                    if (reactor.bonusDefense && reactor.health >= reactor.bonusDefense.health) {
                        defenseDice += reactor.bonusDefense.bonus;
                    }
                    if (reactor.hunker) {
                        if (!actor.ignoreCover) {
                            defenseDice += reactor.hunker;
                        }
                        if (reactor.hunkerRanged) {
                            defenseDice += reactor.hunkerRanged;
                        }
                    }
                    attackResult = makeAttack(attackDice, actor.disarmed ? [[]] : actor.rangedExpertise, actor.rerollFailures);
                    defenseResult = makeDefense(defenseDice, reactor.exposed ? [[]] : reactor.defenseExpertise, reactor.automaticBlocks, reactor.hunker ? reactor.hunkerExpertiseRanged : 0);
                    verboseLog(attackResult)
                    verboseLog(defenseResult)
                }
                if (attackResult && defenseResult) {
                    const results = resolveNet(attackResult, defenseResult);
                    let successes = results.successes;
                    if (trackSuccesses && actor.name === trackSuccesses) {
                        countSuccesses += successes;
                    }
                    if (successes >= actor.damageTrack.length) {
                        successes = actor.damageTrack.length - 1;
                    }
                    let damage = actor.damageTrack[successes] + results.damage + (performedFreeMove && actor.damageFromFreeMove ? actor.damageFromFreeMove : 0);
                    if (reactor.protection || (reactor.meleeProtection && distance < range[2])) damage = Math.max(0, damage--);
                    let attackerHeal = actor.healTrack ? actor.healTrack[successes] : 0;
                    if (actor.lifeSteal && damage > 0) {
                        attackerHeal++;
                    }
                    const attackerAdvance = actor.advanceTrack ? actor.advanceTrack[successes] : 0;
                    const attackerDashes = actor.dashTrack ? actor.dashTrack[successes] : 0;
                    const applyExposed = actor.exposedTrack ? actor.exposedTrack[successes] : false;
                    const applyDisarmed = actor.disarmedTrack ? actor.disarmedTrack[successes] : false;
                    const applyPinned = actor.pinnedTrack ? actor.pinnedTrack[successes] : false;
                    const applyStrained = actor.strainedTrack ? actor.strainedTrack[successes] : false;
                    const applyPush = actor.pushTrack ? actor.pushTrack[successes] : false;
                    const freeAttack = actor.freeAttackTrack ? actor.freeAttackTrack[successes] : false;
                    let shoves = (actor.shoveTrack ? actor.shoveTrack[successes] : 0) + attackResult.shove;
                    if ((reactor.hunker > 0 && reactor.hunker) || reactor.steadfast) {
                        shoves--;
                    }
                    for (let aa = 0; aa < attackerAdvance; aa++) {
                        handleMove(reactor, movement.advance, plan === 'ranged' ? false : true, false);
                    }
                    for (let ad = 0; ad < attackerDashes; ad++) {
                        handleMove(reactor, movement.dash, plan === 'ranged' ? false : true, false);
                    }
                    if ((enemyPlan === 'melee' || plan === 'ranged') && (a >= attacks - 1)) {
                        for (let sh = 0; sh < shoves; sh++) {
                            handleMove(reactor, range[1], false, true);
                        }
                    }
                    if (reactor.tooFast && isMelee) {
                        handleDamage(reactor, Math.ceil(damage / 2));
                        handleDamage(actor, Math.floor(damage / 2));
                    } else {
                        handleDamage(reactor, damage)
                    }
                    verboseLog(`I inflicted ${damage} damage, leaving my opponent at ${reactor.health}/${reactor.maxHealth} HP`)
                    actor.damageDealt += damage;
                    verboseLog(`I shoved my opponent ${shoves} times`);
                    actor.health = Math.min(actor.maxHealth, actor.health + attackerHeal);
                    if (reactor.health > 0) {
                        reactor.health = Math.min(reactor.maxHealth, reactor.health + results.defenderHeal);
                        for (let ma = 0; ma < results.defenderAdvance; ma++) {
                            handleMove(reactor, movement.advance, enemyPlan === 'ranged' ? false : true, false);
                        }
                        for (let md = 0; md < results.defenderDash; md++) {
                            handleMove(reactor, movement.dash, enemyPlan === 'ranged' ? false : true, false);
                        }
                    }
                    if (actor.strained) {
                        handleDamage(actor, 3)
                        actor.strained = false;
                    }
                    actor.disarmed = false;
                    reactor.exposed = false;
                    if (applyDisarmed) {
                        verboseLog('I disarmed my enemy')
                        if (reactor.disarmed) reactor.health--;
                        reactor.disarmed = true;
                    }
                    if (applyExposed && !reactor.exposedImmune) {
                        verboseLog('I exposed my enemy')
                        if (reactor.exposed) reactor.health--;
                        reactor.exposed = true;
                    }
                    if (applyStrained) {
                        verboseLog('I strained my enemy')
                        if (reactor.strained) reactor.health--;
                        reactor.strained = true;
                    }
                    if (applyPinned && !reactor.pinnedImmune) {
                        verboseLog('I pinned my enemy')
                        if (reactor.pinned) reactor.health--;
                        reactor.pinned = true;
                    }
                    if (applyPush) {
                        handleMove(reactor, actor.pushAbility.distance, actor.pushAbility.pull, true);
                        if (actor.pushAbility.status) {
                            reactor[actor.pushAbility.status] = true;
                        }
                    }
                    if (results.attackerFailures > 0 && reactor.riposte && isMelee) {
                        if (reactor.strained) {
                            if (reactor.health > 3) {
                                handleDamage(actor, reactor.riposte);
                                handleDamage(reactor, 3);
                                reactor.strained = false;
                            }
                        } else {
                            handleDamage(actor, reactor.riposte);
                        }
                    }
                    if (results.attackerFailures > 0 && reactor.healposte && isMelee) {
                        if (reactor.strained) {
                            reactor.health = Math.min(reactor.maxHealth, reactor.health + reactor.healposte.heal - 1);
                            handleMove(reactor, reactor.healposte.move);
                            reactor.strained = false;
                        } else {
                            reactor.health = Math.min(reactor.maxHealth, reactor.health + reactor.healposte.heal);
                        }
                    }
                    if (results.attackerFailures > 0 && reactor.deflect && !isMelee) {
                        if (reactor.strained) {
                            if (reactor.health > 3) {
                                handleDamage(actor, reactor.deflect);
                                handleDamage(reactor, 3);
                                reactor.strained = false;
                            }
                        } else {
                            handleDamage(actor, reactor.deflect);
                        }
                    }
                    if (freeAttack && freeAttacks < actor.freeAttackLimit) {
                        freeAttacks++;
                        handleAttack(actor.freeAttackValue);
                    }
                    if (results.attackerFailures > 0 && actor.exposeOnFail) {
                        if (actor.exposed) { actor.health-- }
                        actor.exposed = true;
                    }
                }
            }
            if (actor.combatAI) {
                if (!reactor.exposed && !reactor.exposedImmune) {
                    reactor.exposed = true;
                } else if (!reactor.strained) {
                    reactor.strained = true;
                } else {
                    reactor.health--;
                }
            }
        };

        if (actor.health > 0) {
            if (actor.strained && actor.health <= 3) {
                verboseLog('I am Recovering from Strain');
                actor.strained = false;
                actions--;
            }
            if (actor.freeFocus) {
                actor.focused = true;
            }
            if (actor.firstTurnFocus && turnCounter === 0) {
                actor.focused = true;
            }
            if (plan === 'ranged') {
                verboseLog('I am a ranged attacker');
                if (actor.freeMovement) {
                    if (distance > actor.range) {
                        verboseLog('I am moving towards the enemy with my free movement')
                        performedFreeMove = handleMove(actor, actor.freeMovement, true, false);
                    } else if (distance <= range[2]) {
                        verboseLog('I am moving away from the enemy with my free movement')
                        performedFreeMove = handleMove(actor, actor.freeMovement, false, false);
                    }
                    if (performedFreeMove && actor.hunkerOnFreeMove) {
                        actor.hunker += actor.hunkerOnFreeMove;
                    }
                }
                if (distance <= range[2] && actions > 1) {
                    verboseLog('I am moving out of melee', actions)
                    const moved = handleMove(actor, movement.dash, false, false);
                    if (moved) {
                        actions--;
                        if (actor.hunkerOnMove) {
                            actor.hunker += actor.hunkerOnMove;
                        }
                        if (actor.focusOnMove) {
                            actor.focused = true;
                        }
                    }
                }
                if (distance > actor.range && actions > 1 && actor.pinned) {
                    verboseLog('I am Recovering from Pin');
                    actor.pinned = false;
                    actions--;
                }
                if (distance > actor.range && actions > 1) {
                    verboseLog('I am moving into range', actions)
                    const moved = handleMove(actor, movement.advance, true, false);
                    if (moved) {
                        actions--;
                        if (actor.hunkerOnMove) {
                            actor.hunker += actor.hunkerOnMove;
                        }
                        if (actor.focusOnMove) {
                            actor.focused = true;
                        }
                    }
                }
                if (distance <= actor.range && actions > 1 && actor.strained && !impact && !actor.sharpshooter) {
                    verboseLog('I am Recovering from Strain');
                    actor.strained = false;
                    actions--;
                }
                if (distance <= actor.range && actions > 1 && !actor.focused) {
                    actor.focused = true;
                    actions--;
                    verboseLog('I am Focusing', actions)
                }
                verboseLog(`The distance is now ${distance}`);
                if (distance <= actor.range && actions > 0) {
                    verboseLog('I am attacking', actions)
                    handleAttack();
                    actions--;
                }
                if (distance > actor.range && actions > 0) {
                    verboseLog('I am taking cover', actions)
                    actor.hunker++;
                    handleMove(actor, range[1], false, true);
                    actions--;
                }
            }

            if (plan === 'melee') {
                verboseLog('I am a melee attacker')
                if (actor.freeMovement) {
                    performedFreeMove = handleMove(actor, actor.freeMovement, true, false);
                    verboseLog('I am moving towards the enemy with my free movement')
                    if (performedFreeMove && actor.hunkerOnFreeMove) {
                        actor.hunker += actor.hunkerOnFreeMove;
                    }
                }
                if (distance > range[2] && actions > 1) {
                    verboseLog('I am moving towards the enemy', actions)
                    const moved = handleMove(actor, movement.advance, true, true);
                    if (moved) {
                        actions--;
                        if (actor.hunkerOnMove) {
                            actor.hunker += actor.hunkerOnMove;
                        }
                        if (actor.focusOnMove) {
                            actor.focused = true;
                        }
                    }
                }
                if (distance <= range[2] && actions > 1 && !actor.focused) {
                    verboseLog('I am focusing', actions)
                    actor.focused = true;
                    actions--;
                }
                verboseLog(`The distance is now ${distance}`);
                if (distance <= range[2] && actions > 0) {
                    verboseLog('I am attacking', actions)
                    handleAttack();
                }
                if (distance > actor.range && actions > 0) {
                    verboseLog('I am taking cover', actions)
                    actor.hunker++;
                    handleMove(actor, range[1], true, true);
                    actions--;
                }
            }

            if (plan === 'balanced') {
                if (actor.freeMovement) {
                    verboseLog('I am moving towards the enemy with my free movement')
                    performedFreeMove = handleMove(actor, actor.freeMovement, true, false);
                    if (performedFreeMove && actor.hunkerOnFreeMove) {
                        actor.hunker += actor.hunkerOnFreeMove;
                    }
                }
                if (distance > actor.range && actions > 1) {
                    verboseLog('I am moving towards the enemy', actions)
                    const moved = handleMove(actor, movement.advance, true, false);
                    if (moved) {
                        actions--;
                        if (actor.hunkerOnMove) {
                            actor.hunker += actor.hunkerOnMove;
                        }
                        if (actor.focusOnMove) {
                            actor.focused = true;
                        }
                    }
                }
                if (distance <= actor.range && actions > 1 && !actor.focused) {
                    verboseLog('I am focusing', actions)
                    actor.focused = true;
                    actions--;
                }
                verboseLog(`The distance is now ${distance}`);
                if (distance <= actor.range && actions > 0) {
                    verboseLog('I am attacking', actions)
                    handleAttack();
                    actions--;
                }
                if (distance > actor.range && actions > 0) {
                    verboseLog('I am taking cover', actions)
                    actor.hunker++;
                    handleMove(actor, range[1], true, true);
                    actions--;
                }
            }
        }
        actor.focused = false;
        reactor.focused = false;
        verboseLog('End of turn. Statuses are:')
    };
    while (attackerStats.health > 0 && defenderStats.health > 0) {
        handleTurn(attackerStats, defenderStats);
        if (attackerStats.health > 0 && defenderStats.health > 0) {
            handleTurn(defenderStats, attackerStats);
        }
        turnCounter++;
        attackerStats.turns++;
        defenderStats.turns++;
    }
    let result = 'debug'
    if (turnCounter > drawLimit) result = 'timeout';
    else if (attackerStats.health <= 0 && defenderStats.health <= 0) result = 'draw';
    else if (attackerStats.health <= 0) result = 'winAsDefender';
    else if (defenderStats.health <= 0) result = 'winAsAttacker';
    reportCallback(result, attackerStats, defenderStats);
};



const handleBracket = (one, two) => {
    const fightOutcome = [0, 0, 0]
    for (let i = 0; i < iterations; i++) {
        const outcome = letsFight(one, two);
        fightOutcome[outcome]++;
    }
    return fightOutcome;
};


const runBasic = (fighters) => {
    const fightOutcomes = {};
    Object.keys(fighters).forEach((primary) => {
        Object.keys(fighters).forEach((foe) => {
            if (!fightOutcomes[primary]) fightOutcomes[primary] = 0;
            if (!fightOutcomes[foe]) fightOutcomes[foe] = 0;
            if (primary !== foe) {
                const result = handleBracket(fighters[primary], fighters[foe]);
                fightOutcomes[primary] += ((result[1] + (result[0] * drawValue)) / (iterations * 2)) / (Object.keys(fighters).length - 1);
                fightOutcomes[foe] += ((result[2] + (result[0] * drawValue)) / (iterations * 2)) / (Object.keys(fighters).length - 1);
            }
        });
    });
    Object.keys(fightOutcomes).forEach(name => {
        verboseLog(`${name}\t${fightOutcomes[name]}`)
    })
};

const runSim = (fighters, victims, trackSuccesses) => {
    const fightOutcomes = {};
    Object.keys(fighters).forEach((attacker) => {
        if (!fighters[attacker].basic) {
            Object.keys(victims).forEach(defender => {
                if (!victims[defender].basic) {
                    if (attacker !== defender) {
                        if (!fightOutcomes[attacker]) fightOutcomes[attacker] = {
                            winAsAttacker: 0,
                            winAsDefender: 0,
                            drawAsAttacker: 0,
                            timeoutAsAttacker: 0,
                            drawAsDefender: 0,
                            timeoutAsDefender: 0,
                            debugAsAttacker: 0,
                            debugAsDefender: 0,
                            damageDone: 0
                        };
                        if (!fightOutcomes[defender]) fightOutcomes[defender] = {
                            winAsAttacker: 0,
                            winAsDefender: 0,
                            drawAsAttacker: 0,
                            timeoutAsAttacker: 0,
                            drawAsDefender: 0,
                            timeoutAsDefender: 0,
                            debugAsAttacker: 0,
                            debugAsDefender: 0,
                            damageDone: 0
                        };
                        // console.log(`${attacker} vs ${defender}`)
                        for (let i = 0; i < iterations; i++) {
                            showdown(fighters[attacker], victims[defender], (fightOutcome, attackerStats, defenderStats) => {
                                fightOutcomes[attacker].damageDone += attackerStats.damageDealt / attackerStats.turns;
                                if (attacker === trackSuccesses) {
                                    fightOutcomes[defender]['trackedSuccesses'] += successes;
                                }
                                if (fightOutcome === 'winAsAttacker') {
                                    fightOutcomes[attacker]['winAsAttacker']++
                                } else if (fightOutcome === 'winAsDefender') {
                                    fightOutcomes[defender]['winAsDefender']++;
                                } else {
                                    fightOutcomes[attacker][fightOutcome + 'AsAttacker']++;
                                    fightOutcomes[defender][fightOutcome + 'AsDefender']++;
                                }
                            }, trackSuccesses);
                        }
                    }
                }
            });
        }
    })
    const divisor = iterations * Math.max(Math.min(Object.keys(fighters).length - 1, Object.keys(victims).length - 1), 1);
    const toDisplayValue = (numVal) => {
        return Math.trunc((numVal / divisor) * 100);
    }
    Object.keys(fightOutcomes).forEach(outcome => {
        if (trackSuccesses) {
            console.log(`${outcome}\t${Math.trunc(fightOutcomes[outcome].trackedSuccesses / iterations * 10) / 10}`);
        } else {
            console.log(`${outcome}\t${toDisplayValue(fightOutcomes[outcome].winAsAttacker)}\t${toDisplayValue(fightOutcomes[outcome].winAsDefender)}\t${toDisplayValue(fightOutcomes[outcome].timeoutAsAttacker)}\t${Math.trunc(fightOutcomes[outcome].damageDone / divisor)}`)
        }
    })
};

const promotedPrimaries = {
    ...stats.primaries,
    Jango: stats.secondaries.Jango,
    Kraken: stats.secondaries.Kraken,
    FifthBrother: stats.supports.FifthBrother,
    Cody: stats.secondaries.Cody,
    Rex: stats.secondaries.Rex,
    PadawanAhsokaHealFocus: stats.secondaries.PadawanAshokaHealFocus,
    PadawanAhsoka: stats.secondaries.PadawanAshoka,
    MandalorianCommandos: stats.supports.MandalorianCommandos,
    Savage: stats.secondaries.Savage
}

const promotedSecondaries = {
    ...stats.secondaries,
    AhsokaShien: stats.primaries.AhsokaShien,
    GIMakashiRecords: stats.primaries.GIMakashiRecords,
    LuminaraSoresu: stats.primaries.LuminaraSoresu,
    AnakinShienHealFocus: stats.primaries.AnakinShienHealingFocus,
    TalzinWrath: stats.primaries.TalzinWrath,
    MandalorianCommandos: stats.supports.MandalorianCommandos,
    B2sSaturation: stats.supports.B2sSaturation,
    MagnaGuard: stats.supports.MagnaGuard,
    NightsisterAcolytesHunter: stats.supports.NightsisterAcolytesHunter,
    FifthBrother: stats.supports.FifthBrother,
    FourthSister: stats.supports.FourthSister,
}

const promotedSupports = {
    ...stats.supports,
    HoboKenobiStand: stats.secondaries.HoboKenobiStand,
    Barriss: stats.secondaries.Barriss,
    BoKatan: stats.secondaries.BoKatan,
    AhsokaShien: stats.primaries.AhsokaShien
}

const everyone = {
    ...stats.primaries,
    ...stats.secondaries,
    ...stats.supports
}

const kingAnakin = {
    VaderRage: stats.primaries.VaderRage,
    VaderServantDjem: stats.primaries.VaderServantDjem
}

const sabe = {
    Sabe: stats.secondaries.Sabe
}

const motherMayI = {
    TalzinWrath: stats.primaries.KenobiAtaru
}

const grievousMistake = {
    GrievousQuad: stats.primaries.GrievousQuad,
    HookDuelist: stats.KingdomHeartsPrimaries.HookDuelist
}

const primariesSavage = {
    ...stats.primaries,
    SecondSisterTelekinetic: stats.otherHomebrew.SecondSisterTelekinetic,
    SecondSisterVicious: stats.otherHomebrew.SecondSisterVicious
}

const supportTest = {
    ...stats.supports,
    PurgeTrooper: stats.otherHomebrew.PurgeTroopers,
    MagnaGuard: stats.supports.MagnaGuard
}

const KHPrimaryCrossover = {
    ...stats.primaries,
    ...stats.KingdomHeartsPrimaries
}
const KHSecondaryCrossover = {
    ...stats.secondaries,
    ...stats.KingdomHeartsPrimaries,
    ...stats.KingdomHeartsSecondaries
}
const KHSupportCrossover = {
    ...stats.supports,
    ...stats.KingdomHeartsPrimaries,
    ...stats.KingdomHeartsSecondaries
}

const KHEveryone = {
    ...stats.KingdomHeartsPrimaries,
    ...stats.KingdomHeartsSecondaries
}

const Dooku = {
    Dooku: stats.primaries.DookuMakashi
}

const GRVSDooku = {
    KenobiAtaru: stats.primaries.KenobiAtaru,
    KenobiSoresu: stats.primaries.KenobiSoresu,
    AnakinDjem: stats.primaries.AnakinDjem,
    AnakinShien: stats.primaries.AnakinShien,
    PloDjem: stats.primaries.PloDjem,
    PloSoresu: stats.primaries.PloSoresu,
    LuminaraSoresu: stats.primaries.LuminaraSoresu,
    LuminaraMakashi: stats.primaries.LuminaraMakashi,
    WinduVapaad: stats.primaries.WinduVapaad,
    WinduJedi: stats.primaries.WinduJedi,
    VaderDjem: stats.primaries.VaderDjem,
    VaderRage: stats.primaries.VaderRage
}

const rangedMatchup = {};

Object.keys(stats.primaries).forEach((key) => {
    let primary = stats.primaries[key];
    if (primary.plan !== 'melee') {
        primary.plan = 'ranged';
        rangedMatchup[key] = primary;
    }
})
Object.keys(stats.secondaries).forEach((key) => {
    let secondary = stats.secondaries[key];
    if (secondary.plan !== 'melee') {
        secondary.plan = 'ranged';
        rangedMatchup[key] = secondary;
    }
})

// verbose = true;
// iterations = 1;

// console.log(Object.keys(stats.primaries))
// runSim(stats.supports, stats.supports);
// runSim(stats.KingdomHeartsSecondaries, stats.KingdomHeartsSecondaries);
runSim(rangedMatchup, rangedMatchup);
// console.log(Object.keys(stats.KingdomHeartsPrimaries).length / 2 + Object.keys(stats.KingdomHeartsSecondaries).length - 1)
// console.log((Object.keys(stats.primaries).length - 1) / 2 + Object.keys(stats.secondaries).length + Object.keys(stats.supports).length)
// runSim(KHEveryone, KHEveryone);
// console.log(showdown(stats.secondaries.Sabe, stats.primaries.VentressJar))