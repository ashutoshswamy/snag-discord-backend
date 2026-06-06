const activeTimeouts = new Map();

/**
 * Recursively disables all interactive components (buttons, select menus) in the components array.
 * Works with both discord.js builder objects and raw JSON components.
 */
export function disableAllComponents(components) {
  if (!components || !Array.isArray(components)) return components;

  return components.map(c => {
    // If it's a builder with setDisabled method
    if (typeof c.setDisabled === 'function') {
      c.setDisabled(true);
    }
    // If it has data with setDisabled
    else if (c.data && typeof c.data.setDisabled === 'function') {
      c.data.setDisabled(true);
    }
    // If it is a raw API component representing an interactive element
    // 2 = Button, 3 = StringSelect, 5 = UserSelect, 6 = RoleSelect, 7 = MentionableSelect, 8 = ChannelSelect
    else if (c.type === 2 || c.type === 3 || c.type === 5 || c.type === 6 || c.type === 7 || c.type === 8) {
      c.disabled = true;
    }

    // Recursively handle nested components (Container, ActionRow, etc.)
    if (c.components && Array.isArray(c.components)) {
      disableAllComponents(c.components);
    }

    return c;
  });
}

/**
 * Registers a component timeout for a given message.
 * @param {string} messageId The ID of the message.
 * @param {object} interaction The interaction object.
 * @param {Array} components The original components array/builders.
 * @param {number} duration Timeout duration in milliseconds (default 60000ms / 1 minute).
 */
export function registerComponentTimeout(messageId, interaction, components, duration = 60000) {
  if (!messageId || !interaction || !components) return;

  // Clear any existing timeout for this message
  if (activeTimeouts.has(messageId)) {
    clearTimeout(activeTimeouts.get(messageId).timer);
  }

  const timer = setTimeout(async () => {
    activeTimeouts.delete(messageId);
    try {
      const disabled = disableAllComponents(components);
      await interaction.editReply({ components: disabled }).catch(() => null);
    } catch (err) {
      // Ignore: interaction expired, message deleted, etc.
    }
  }, duration);

  activeTimeouts.set(messageId, { timer, interaction, components, duration });
}

/**
 * Extends the component timeout for a message.
 * @param {string} messageId The ID of the message.
 * @param {Array} newComponents The new components array/builders.
 * @param {object} newInteraction Optional new interaction object to use.
 */
export function extendComponentTimeout(messageId, newComponents = null, newInteraction = null) {
  if (!messageId) return;

  const record = activeTimeouts.get(messageId);
  if (!record) return;

  clearTimeout(record.timer);

  if (newComponents) {
    record.components = newComponents;
  }
  if (newInteraction) {
    record.interaction = newInteraction;
  }

  record.timer = setTimeout(async () => {
    activeTimeouts.delete(messageId);
    try {
      const disabled = disableAllComponents(record.components);
      await record.interaction.editReply({ components: disabled }).catch(() => null);
    } catch (err) {
      // Ignore
    }
  }, record.duration);
}

/**
 * Clears the component timeout for a message.
 * @param {string} messageId The ID of the message.
 */
export function clearComponentTimeout(messageId) {
  if (!messageId) return;

  const record = activeTimeouts.get(messageId);
  if (record) {
    clearTimeout(record.timer);
    activeTimeouts.delete(messageId);
  }
}
