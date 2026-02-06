/**
 * Chat commands - send messages to token chats
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  spinner,
  shortenAddress,
  handleError,
  success,
  info,
  warn,
  error,
  createClientWithWallet,
  requireWallet,
  requireAuth,
} from '../utils';
import type { ChatMessage } from '@clawdvault/sdk';

export const chatCommand = new Command('chat')
  .description('Token chat operations');

// Send message
chatCommand
  .command('send')
  .description('Send a chat message to a token')
  .requiredOption('-m, --mint <address>', 'Token mint address')
  .argument('<message>', 'Message to send')
  .option('-w, --wallet <path>', 'Wallet file path')
  .option('--reply <id>', 'Reply to message ID')
  .option('--json', 'Output as JSON')
  .action(async (message: string, options) => {
    const spin = spinner('Sending message...').start();
    
    try {
      // Check auth first
      const auth = requireAuth();
      
      const { client, signer, walletAddress } = createClientWithWallet(options.wallet);
      
      // Wallet required for identifying sender
      if (!signer) {
        spin.stop();
        warn('Wallet recommended for chat (using session wallet)');
      }
      
      const result = await client.sendChat({
        mint: options.mint,
        message: message,
        replyTo: options.reply,
      });
      
      spin.stop();
      
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      
      if (result.success) {
        success('Message sent!');
        console.log();
        
        const msg = result.message;
        if (msg) {
          info(`ID: ${msg.id}`);
          if (msg.created_at) {
            info(`Time: ${new Date(msg.created_at).toLocaleString()}`);
          }
        }
      } else {
        error('Failed to send message');
      }
      console.log();
    } catch (err) {
      spin.stop();
      handleError(err);
    }
  });

// Get chat history
chatCommand
  .command('history')
  .description('Get chat history for a token')
  .requiredOption('-m, --mint <address>', 'Token mint address')
  .option('-l, --limit <number>', 'Number of messages to fetch', '20')
  .option('--before <id>', 'Get messages before this ID')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spin = spinner('Fetching messages...').start();
    
    try {
      const { client } = createClientWithWallet();
      
      const result = await client.getChat({
        mint: options.mint,
        limit: parseInt(options.limit, 10),
        before: options.before,
      });
      
      spin.stop();
      
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      
      const messages = result.messages || [];
      
      if (messages.length === 0) {
        info('No messages found');
        return;
      }
      
      console.log(chalk.bold(`\n💬 Chat History - ${shortenAddress(options.mint)}\n`));
      
      // Display messages (oldest first)
      const sorted = [...messages].reverse();
      for (const msg of sorted) {
        const time = msg.created_at 
          ? new Date(msg.created_at).toLocaleTimeString()
          : '??:??';
        const sender = msg.username || (msg.wallet ? shortenAddress(msg.wallet) : 'unknown');
        const replyPrefix = msg.reply_to ? chalk.dim(`↩ ${shortenAddress(msg.reply_to)} `) : '';
        
        console.log(
          `${chalk.dim(time)} ${chalk.cyan(sender)}: ${replyPrefix}${msg.message || ''}`
        );
      }
      
      console.log();
      info(`Showing ${messages.length} messages`);
      if (messages.length > 0) {
        info(`Use --before ${messages[messages.length - 1]?.id} for older messages`);
      }
      console.log();
    } catch (err) {
      spin.stop();
      handleError(err);
    }
  });

// React to message
chatCommand
  .command('react')
  .description('Add reaction to a message')
  .requiredOption('-i, --id <messageId>', 'Message ID')
  .requiredOption('-e, --emoji <emoji>', 'Emoji to react with')
  .option('-w, --wallet <path>', 'Wallet file path')
  .action(async (options) => {
    const spin = spinner('Adding reaction...').start();
    
    try {
      requireAuth();
      const { client } = createClientWithWallet(options.wallet);
      
      await client.addReaction(options.id, options.emoji);
      
      spin.stop();
      success(`Reacted with ${options.emoji}`);
      console.log();
    } catch (err) {
      spin.stop();
      handleError(err);
    }
  });

// Remove reaction
chatCommand
  .command('unreact')
  .description('Remove reaction from a message')
  .requiredOption('-i, --id <messageId>', 'Message ID')
  .requiredOption('-e, --emoji <emoji>', 'Emoji to remove')
  .option('-w, --wallet <path>', 'Wallet file path')
  .action(async (options) => {
    const spin = spinner('Removing reaction...').start();
    
    try {
      requireAuth();
      const { client } = createClientWithWallet(options.wallet);
      
      await client.removeReaction(options.id, options.emoji);
      
      spin.stop();
      success(`Removed ${options.emoji} reaction`);
      console.log();
    } catch (err) {
      spin.stop();
      handleError(err);
    }
  });
